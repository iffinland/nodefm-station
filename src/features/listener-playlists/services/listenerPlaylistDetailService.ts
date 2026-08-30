/* ============================================================
 * NodeFM Station — Listener Playlist Detail Service
 *
 * Read-only reconstruction of a listener-owned published playlist
 * version. Track metadata resolves from the canonical NodeFM station
 * library even though the playlist/version resources belong to the
 * listener registered name.
 * ============================================================ */

import { fetchQdnResourceData } from '../../../qortium/qdn';
import type { Playlist, PlaylistVersion, PlaylistVersionTrack, Track } from '../../../types/domain';
import type { AudioTrack } from '../../../audio/playbackTypes';
import {
  deserializePlaylistFromQdn,
  deserializePlaylistVersionFromQdn,
} from '../../playlists/services/playlistService';
import { deserializeTrackFromQdn, getTrackQdnIdentifier } from '../../tracks/services/trackService';
import { resolveTrackPlayback, resolveQdnCoverUrl } from '../../radio/player/resolveTrackPlayback';
import {
  deserializeSubmissionFromQdn,
  getSubmissionQdnIdentifier,
  validateSubmissionStructuralIntegrity,
} from '../../listener-submissions/services/submissionService';
import { listenerSubmissionToTrack } from '../../listener-uploads/services/listenerTrackService';
import {
  getListenerPlaylistQdnIdentifier,
  getListenerPlaylistVersionQdnIdentifier,
} from './listenerPlaylistService';

export type ListenerPlaylistDetailTrack = {
  track: Track;
  coverUrl?: string;
};

export type ListenerPlaylistDetail = {
  playlist: Playlist;
  version: PlaylistVersion;
  tracks: ListenerPlaylistDetailTrack[];
};

export type ListenerPlaylistDetailResult =
  | { status: 'ready'; detail: ListenerPlaylistDetail }
  | { status: 'not-found'; message: string }
  | { status: 'version-missing'; message: string }
  | { status: 'version-malformed'; message: string }
  | {
      status: 'tracks-unavailable';
      message: string;
      version: PlaylistVersion;
      failedTrackIds: string[];
    };

export type ResolvedListenerPlaylistAudio = {
  tracks: AudioTrack[];
  missing: Array<{ index: number; trackId: string; title: string }>;
};

async function loadListenerVersionTrack(
  versionTrack: PlaylistVersionTrack,
  listenerName: string,
  stationPublisherName: string,
): Promise<Track> {
  const kind = versionTrack.kind ?? 'STATION_TRACK';

  if (kind === 'STATION_TRACK') {
    const payload = await fetchQdnResourceData({
      service: 'JSON',
      name: stationPublisherName,
      identifier: getTrackQdnIdentifier(versionTrack.trackId),
    });
    const track = deserializeTrackFromQdn(payload);

    if (!track || track.trackId !== versionTrack.trackId) {
      throw new Error(`Station Track could not be reconstructed: ${versionTrack.trackId}`);
    }

    return track;
  }

  if (kind === 'OWNER_TRACK') {
    const ownerName = versionTrack.ownerName?.trim() || listenerName.trim();
    if (ownerName !== listenerName.trim()) {
      throw new Error('Listener playlist references another listener-owned Track.');
    }

    const identifier = getSubmissionQdnIdentifier(versionTrack.trackId);
    const payload = await fetchQdnResourceData({
      service: 'JSON',
      name: ownerName,
      identifier,
    });
    const submission = deserializeSubmissionFromQdn(payload);

    if (!submission) {
      throw new Error(`Listener Track could not be reconstructed: ${versionTrack.trackId}`);
    }

    const structural = validateSubmissionStructuralIntegrity(submission, ownerName, identifier);
    if (!structural.ok) {
      throw new Error('Listener Track resource is malformed.');
    }

    return listenerSubmissionToTrack(submission);
  }

  throw new Error(`Unsupported playlist track kind: ${String(versionTrack.kind)}`);
}

export async function loadListenerPlaylistVersionDetail(
  listenerName: string,
  stationPublisherName: string,
  playlistId: string,
  versionId: string,
): Promise<ListenerPlaylistDetailResult> {
  if (!listenerName || !stationPublisherName || !playlistId || !versionId) {
    return {
      status: 'not-found',
      message: 'Listener, station, playlist, and version IDs are required.',
    };
  }

  let playlist: Playlist | null = null;
  try {
    const payload = await fetchQdnResourceData({
      service: 'PLAYLIST',
      name: listenerName,
      identifier: getListenerPlaylistQdnIdentifier(playlistId),
    });
    playlist = deserializePlaylistFromQdn(payload);
  } catch {
    return {
      status: 'not-found',
      message: `Listener playlist could not be loaded: ${playlistId}`,
    };
  }

  if (!playlist || playlist.playlistId !== playlistId) {
    return { status: 'not-found', message: `Listener playlist record is invalid: ${playlistId}` };
  }

  let version: PlaylistVersion;
  try {
    const payload = await fetchQdnResourceData({
      service: 'JSON',
      name: listenerName,
      identifier: getListenerPlaylistVersionQdnIdentifier(versionId),
    });
    version = deserializePlaylistVersionFromQdn(payload) as PlaylistVersion;
  } catch {
    return {
      status: 'version-missing',
      message: `Listener playlist version could not be loaded: ${versionId}`,
    };
  }

  if (
    !version ||
    version.playlistId !== playlistId ||
    version.versionId !== versionId ||
    version.tracks.length === 0 ||
    version.totalDurationMs !== version.tracks.reduce((sum, track) => sum + track.durationMs, 0)
  ) {
    return { status: 'version-malformed', message: 'Listener playlist version is malformed.' };
  }

  const tracks: ListenerPlaylistDetailTrack[] = [];
  const failedTrackIds: string[] = [];

  for (const versionTrack of version.tracks) {
    try {
      const track = await loadListenerVersionTrack(
        versionTrack,
        listenerName,
        stationPublisherName,
      );
      tracks.push({ track });
    } catch {
      failedTrackIds.push(versionTrack.trackId);
    }
  }

  if (failedTrackIds.length > 0) {
    return {
      status: 'tracks-unavailable',
      message: `${failedTrackIds.length} track(s) could not be reconstructed.`,
      version,
      failedTrackIds,
    };
  }

  return {
    status: 'ready',
    detail: {
      playlist,
      version,
      tracks,
    },
  };
}

export async function loadListenerPlaylistDetail(
  listenerName: string,
  stationPublisherName: string,
  playlistId: string,
): Promise<ListenerPlaylistDetailResult> {
  if (!listenerName || !stationPublisherName || !playlistId) {
    return { status: 'not-found', message: 'Listener, station, and playlist IDs are required.' };
  }

  let playlist: Playlist | null = null;
  try {
    const payload = await fetchQdnResourceData({
      service: 'PLAYLIST',
      name: listenerName,
      identifier: getListenerPlaylistQdnIdentifier(playlistId),
    });
    playlist = deserializePlaylistFromQdn(payload);
  } catch {
    return {
      status: 'not-found',
      message: `Listener playlist could not be loaded: ${playlistId}`,
    };
  }

  if (!playlist || playlist.playlistId !== playlistId) {
    return { status: 'not-found', message: `Listener playlist record is invalid: ${playlistId}` };
  }

  if (!playlist.latestVersionId) {
    return { status: 'version-missing', message: 'This playlist has no published version yet.' };
  }

  let version: PlaylistVersion;
  try {
    const payload = await fetchQdnResourceData({
      service: 'JSON',
      name: listenerName,
      identifier: getListenerPlaylistVersionQdnIdentifier(playlist.latestVersionId),
    });
    version = deserializePlaylistVersionFromQdn(payload) as PlaylistVersion;
  } catch {
    return {
      status: 'version-missing',
      message: `Listener playlist version could not be loaded: ${playlist.latestVersionId}`,
    };
  }

  if (
    !version ||
    version.playlistId !== playlistId ||
    version.versionId !== playlist.latestVersionId ||
    version.tracks.length === 0 ||
    version.totalDurationMs !== version.tracks.reduce((sum, track) => sum + track.durationMs, 0)
  ) {
    return { status: 'version-malformed', message: 'Listener playlist version is malformed.' };
  }

  const tracks: ListenerPlaylistDetailTrack[] = [];
  const failedTrackIds: string[] = [];

  for (const versionTrack of version.tracks) {
    try {
      const track = await loadListenerVersionTrack(
        versionTrack,
        listenerName,
        stationPublisherName,
      );
      tracks.push({ track });
    } catch {
      failedTrackIds.push(versionTrack.trackId);
    }
  }

  if (failedTrackIds.length > 0) {
    return {
      status: 'tracks-unavailable',
      message: `${failedTrackIds.length} track(s) could not be reconstructed.`,
      version,
      failedTrackIds,
    };
  }

  const tracksWithCovers = await Promise.all(
    tracks.map(async (entry) => {
      if (!entry.track.cover) return entry;
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
      version,
      tracks: tracksWithCovers,
    },
  };
}

export async function resolveListenerPlaylistAudio(
  tracks: readonly ListenerPlaylistDetailTrack[],
): Promise<ResolvedListenerPlaylistAudio> {
  const resolved = await Promise.all(
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

  return {
    tracks: resolved
      .filter((entry): entry is typeof entry & { audio: AudioTrack } => entry.audio !== null)
      .map((entry) => entry.audio),
    missing: resolved
      .filter((entry) => entry.audio === null)
      .map((entry) => ({
        index: entry.index,
        trackId: entry.trackId,
        title: entry.title,
      })),
  };
}
