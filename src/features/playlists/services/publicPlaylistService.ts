/* ============================================================
 * NodeFM Station — Public Playlist Discovery and Playback Data
 *
 * Read-only public station playlist browsing and canonical
 * immutable version reconstruction. This service owns QDN
 * lookup/deserialization for public playlists; UI components
 * consume typed results instead of raw bridge calls.
 * ============================================================ */

import { fetchQdnResourceData, searchQdnResources } from '../../../qortium/qdn';
import type { Playlist, PlaylistVersion, Track } from '../../../types/domain';
import {
  deserializePlaylistFromQdn,
  deserializePlaylistVersionFromQdn,
  getPlaylistQdnIdentifier,
  getPlaylistVersionQdnIdentifier,
} from './playlistService';
import { deserializeTrackFromQdn, getTrackQdnIdentifier } from '../../tracks/services/trackService';
import { resolveQdnCoverUrl, resolveTrackPlayback } from '../../radio/player/resolveTrackPlayback';
import type { AudioTrack } from '../../../audio/playbackTypes';

const PLAYLIST_SERVICE = 'PLAYLIST';
const VERSION_SERVICE = 'JSON';
const TRACK_SERVICE = 'JSON';
const PLAYLIST_IDENTIFIER_PREFIX = 'nodefm-playlist-';

export type PublicPlaylistVersionStatus = 'ready' | 'missing' | 'malformed';

export type PublicPlaylist = Playlist & {
  publisherName: string;
  qdnIdentifier: string;
  trackCount: number;
  totalDurationMs: number;
  versionStatus: PublicPlaylistVersionStatus;
  versionError?: string;
  coverUrl?: string;
};

export type PublicPlaylistTrack = {
  track: Track;
  coverUrl?: string;
};

export type PublicPlaylistDetail = {
  playlist: Playlist;
  publisherName: string;
  version: PlaylistVersion;
  tracks: PublicPlaylistTrack[];
};

export type PublicPlaylistDetailResult =
  | {
      status: 'ready';
      detail: PublicPlaylistDetail;
    }
  | {
      status: 'not-found';
      message: string;
    }
  | {
      status: 'private';
      message: string;
      playlist?: Playlist;
      publisherName: string;
    }
  | {
      status: 'invalid-playlist';
      message: string;
    }
  | {
      status: 'version-missing';
      message: string;
      playlist?: Playlist;
      publisherName: string;
    }
  | {
      status: 'version-malformed';
      message: string;
      playlist?: Playlist;
      publisherName: string;
    }
  | {
      status: 'tracks-unavailable';
      message: string;
      playlist?: Playlist;
      version?: PlaylistVersion;
      failedTrackIds: string[];
      publisherName: string;
    };

export type ResolvedPublicPlaylistAudio =
  | {
      status: 'ready';
      tracks: AudioTrack[];
    }
  | {
      status: 'audio-unavailable';
      message: string;
      failed: Array<{ index: number; trackId: string; title: string }>;
    };

function isPublicPlaylist(value: Playlist): boolean {
  return value.visibility === 'public';
}

async function loadPlaylistVersionForPublisher(
  publisherName: string,
  playlist: Playlist,
): Promise<PlaylistVersion> {
  const payload = await fetchQdnResourceData({
    service: VERSION_SERVICE,
    name: publisherName,
    identifier: getPlaylistVersionQdnIdentifier(playlist.latestVersionId),
  });
  const version = deserializePlaylistVersionFromQdn(payload);
  const computedTotalDurationMs = version
    ? version.tracks.reduce((sum, track) => sum + track.durationMs, 0)
    : 0;

  if (
    !version ||
    version.versionId !== playlist.latestVersionId ||
    version.playlistId !== playlist.playlistId ||
    version.totalDurationMs <= 0 ||
    version.totalDurationMs !== computedTotalDurationMs ||
    version.tracks.length === 0
  ) {
    throw new Error(`Invalid playlist version: ${playlist.latestVersionId}`);
  }

  return version;
}

async function resolveCoverUrlForPlaylist(playlist: Playlist): Promise<string | undefined> {
  if (!playlist.cover) {
    return undefined;
  }

  return resolveQdnCoverUrl(playlist.cover);
}

async function buildPublicPlaylist(
  publisherName: string,
  qdnIdentifier: string,
  playlist: Playlist,
): Promise<PublicPlaylist> {
  const coverUrl = await resolveCoverUrlForPlaylist(playlist);

  try {
    const version = await loadPlaylistVersionForPublisher(publisherName, playlist);
    return {
      ...playlist,
      publisherName,
      qdnIdentifier,
      trackCount: version.tracks.length,
      totalDurationMs: version.totalDurationMs,
      versionStatus: 'ready',
      coverUrl,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Playlist version unavailable.';
    const versionStatus: PublicPlaylistVersionStatus = message.startsWith(
      'Invalid playlist version',
    )
      ? 'malformed'
      : 'missing';

    return {
      ...playlist,
      publisherName,
      qdnIdentifier,
      trackCount: 0,
      totalDurationMs: 0,
      versionStatus,
      versionError: message,
      coverUrl,
    };
  }
}

export async function loadPublicPlaylists(publisherName?: string): Promise<PublicPlaylist[]> {
  if (!publisherName) {
    return [];
  }

  const results = await searchQdnResources({
    service: PLAYLIST_SERVICE,
    name: publisherName,
    query: PLAYLIST_IDENTIFIER_PREFIX,
    prefix: true,
    mode: 'ALL',
    limit: 500,
    includeMetadata: true,
  });

  const uniqueRefs = new Map<string, { name: string; identifier: string }>();

  for (const result of results) {
    if (
      !result.name ||
      result.name !== publisherName ||
      !result.identifier?.startsWith(PLAYLIST_IDENTIFIER_PREFIX)
    ) {
      continue;
    }

    uniqueRefs.set(`${result.name}\u0000${result.identifier}`, {
      name: result.name,
      identifier: result.identifier,
    });
  }

  const playlists: PublicPlaylist[] = [];

  for (const ref of uniqueRefs.values()) {
    try {
      const payload = await fetchQdnResourceData({
        service: PLAYLIST_SERVICE,
        name: ref.name,
        identifier: ref.identifier,
      });
      const playlist = deserializePlaylistFromQdn(payload);

      if (!playlist || !isPublicPlaylist(playlist)) {
        continue;
      }

      playlists.push(await buildPublicPlaylist(ref.name, ref.identifier, playlist));
    } catch {
      // Malformed/unavailable logical playlists are isolated; they do not
      // prevent other valid public playlists from being listed.
    }
  }

  return playlists.sort((left, right) => left.title.localeCompare(right.title));
}

export async function loadPublicPlaylistDetail(
  publisherName: string,
  playlistId: string,
): Promise<PublicPlaylistDetailResult> {
  if (!publisherName || !playlistId) {
    return {
      status: 'not-found',
      message: 'A station publisher and playlist identifier are required.',
    };
  }

  const qdnIdentifier = getPlaylistQdnIdentifier(playlistId);
  let playlist: Playlist | null = null;

  try {
    const payload = await fetchQdnResourceData({
      service: PLAYLIST_SERVICE,
      name: publisherName,
      identifier: qdnIdentifier,
    });
    playlist = deserializePlaylistFromQdn(payload);
  } catch {
    return {
      status: 'not-found',
      message: `Public playlist could not be loaded: ${qdnIdentifier}`,
    };
  }

  if (!playlist || playlist.playlistId !== playlistId) {
    return {
      status: 'invalid-playlist',
      message: `Playlist record is malformed or does not match: ${qdnIdentifier}`,
    };
  }

  if (!isPublicPlaylist(playlist)) {
    return {
      status: 'private',
      message: 'This playlist is private.',
      playlist,
      publisherName,
    };
  }

  if (!playlist.latestVersionId) {
    return {
      status: 'version-missing',
      message: 'This public playlist has no published version yet.',
      playlist,
      publisherName,
    };
  }

  let version: PlaylistVersion;
  try {
    version = await loadPlaylistVersionForPublisher(publisherName, playlist);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Playlist version unavailable.';
    return {
      status: message.startsWith('Invalid playlist version')
        ? 'version-malformed'
        : 'version-missing',
      message,
      playlist,
      publisherName,
    };
  }

  const tracks: PublicPlaylistTrack[] = [];
  const failedTrackIds: string[] = [];

  for (const versionTrack of version.tracks) {
    try {
      const payload = await fetchQdnResourceData({
        service: TRACK_SERVICE,
        name: publisherName,
        identifier: getTrackQdnIdentifier(versionTrack.trackId),
      });
      const track = deserializeTrackFromQdn(payload);

      if (!track || track.trackId !== versionTrack.trackId) {
        failedTrackIds.push(versionTrack.trackId);
        continue;
      }

      tracks.push({ track });
    } catch {
      failedTrackIds.push(versionTrack.trackId);
    }
  }

  if (failedTrackIds.length > 0) {
    return {
      status: 'tracks-unavailable',
      message: `${failedTrackIds.length} track(s) could not be reconstructed.`,
      playlist,
      version,
      failedTrackIds,
      publisherName,
    };
  }

  const tracksWithCovers = await Promise.all(
    tracks.map(async (entry) => {
      if (!entry.track.cover) {
        return entry;
      }

      return {
        ...entry,
        coverUrl: await resolveQdnCoverUrl(entry.track.cover),
      };
    }),
  );

  return {
    status: 'ready',
    detail: {
      playlist,
      publisherName,
      version,
      tracks: tracksWithCovers,
    },
  };
}

export async function resolvePublicPlaylistAudioTracks(
  tracks: readonly PublicPlaylistTrack[],
): Promise<ResolvedPublicPlaylistAudio> {
  const results = await Promise.all(
    tracks.map(async (entry, index) => {
      try {
        const playback = await resolveTrackPlayback(entry.track);
        return {
          index,
          trackId: entry.track.trackId,
          title: entry.track.title,
          audio: {
            url: playback.audioUrl,
            trackId: entry.track.trackId,
            title: entry.track.title,
            artist: entry.track.artist,
            coverUrl: entry.coverUrl,
            durationMs: entry.track.durationMs,
          } satisfies AudioTrack,
        };
      } catch {
        return {
          index,
          trackId: entry.track.trackId,
          title: entry.track.title,
          audio: null,
        };
      }
    }),
  );

  const failed = results
    .filter((result): result is typeof result & { audio: null } => result.audio === null)
    .map((result) => ({
      index: result.index,
      trackId: result.trackId,
      title: result.title,
    }));

  if (failed.length > 0) {
    return {
      status: 'audio-unavailable',
      message: `${failed.length} track(s) are not ready for playback.`,
      failed,
    };
  }

  return {
    status: 'ready',
    tracks: results.map((result) => result.audio as AudioTrack),
  };
}
