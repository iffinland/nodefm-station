/* ============================================================
 * NodeFM Station — Multi-Resource Persistence/Discovery Tests
 *
 * Regression coverage for the Phase 2 blocker where a reload
 * showed only the newest track/playlist. These tests exercise the
 * production QDN-facing services, not a parallel fake domain.
 * ============================================================ */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../qortium/qdn', () => ({
  searchQdnResources: vi.fn(),
  fetchQdnResourceData: vi.fn(),
  publishResource: vi.fn(),
  deleteQdnResource: vi.fn(),
}));

import { publishResource, searchQdnResources, fetchQdnResourceData } from '../qortium/qdn';
import { createTrack } from '../features/tracks/services/trackService';
import { getTrackQdnIdentifier } from '../features/tracks/services/trackService';
import {
  getLibraryTracks,
  loadLibrary,
  addTrackToLibrary,
  resetLibrary,
} from '../features/library/services/libraryService';
import {
  getPlaylists,
  loadPlaylistStore,
  addPlaylist,
  publishPlaylistVersion,
  resetPlaylistStore,
} from '../features/playlists/services/playlistStore';
import {
  getPlaylistQdnIdentifier,
  getPlaylistVersionQdnIdentifier,
} from '../features/playlists/services/playlistService';

const mockedPublish = vi.mocked(publishResource);
const mockedSearch = vi.mocked(searchQdnResources);
const mockedFetch = vi.mocked(fetchQdnResourceData);

const OWNER_NAME = 'Owner';
const OWNER_ADDRESS = 'Q-owner';

function makeTrack(index: number) {
  return createTrack({
    title: `Track ${index}`,
    audio: {
      service: 'AUDIO',
      name: OWNER_NAME,
      identifier: `audio-${index}`,
    },
    durationMs: 1000 + index,
    source: 'station-upload',
    ownerAddress: OWNER_ADDRESS,
  });
}

function trackResource(trackId: string) {
  return {
    service: 'JSON',
    name: OWNER_NAME,
    identifier: getTrackQdnIdentifier(trackId),
  };
}

function trackPayload(trackId: string, index: number) {
  return {
    trackId,
    ownerAddress: OWNER_ADDRESS,
    title: `Track ${index}`,
    audio: {
      service: 'AUDIO',
      name: OWNER_NAME,
      identifier: `audio-${index}`,
    },
    durationMs: 1000 + index,
    source: 'station-upload',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function playlistResource(playlistId: string) {
  return {
    service: 'PLAYLIST',
    name: OWNER_NAME,
    identifier: getPlaylistQdnIdentifier(playlistId),
  };
}

function playlistPayload(playlistId: string, index: number) {
  return {
    playlistId,
    ownerAddress: OWNER_ADDRESS,
    title: `Playlist ${index}`,
    visibility: 'public',
    latestVersionId: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('publication identity', () => {
  beforeEach(() => {
    resetLibrary();
    resetPlaylistStore();
    mockedPublish.mockReset();
    mockedSearch.mockReset();
    mockedFetch.mockReset();
    mockedPublish.mockResolvedValue({ accepted: true } as never);
  });

  it('publishes N tracks with N distinct QDN identifiers', async () => {
    const tracks = [makeTrack(0), makeTrack(1), makeTrack(2)];

    for (const track of tracks) {
      await addTrackToLibrary(track, OWNER_NAME);
    }

    expect(mockedPublish).toHaveBeenCalledTimes(tracks.length);

    const identifiers = mockedPublish.mock.calls.map(([call]) => {
      const payload = call as unknown as { identifier?: string };
      return payload.identifier;
    });

    expect(new Set(identifiers).size).toBe(tracks.length);
    expect(identifiers).toEqual(tracks.map((track) => getTrackQdnIdentifier(track.trackId)));
  });

  it('publishes N playlists with N distinct logical Playlist identifiers', async () => {
    const created = [];

    for (let index = 0; index < 3; index += 1) {
      created.push(
        await addPlaylist(
          {
            title: `Playlist ${index}`,
            ownerAddress: OWNER_ADDRESS,
          },
          OWNER_NAME,
        ),
      );
    }

    expect(mockedPublish).toHaveBeenCalledTimes(created.length);

    const identifiers = mockedPublish.mock.calls.map(([call]) => {
      const payload = call as unknown as { identifier?: string };
      return payload.identifier;
    });

    expect(new Set(identifiers).size).toBe(created.length);
    expect(identifiers).toEqual(
      created.map((playlist) => getPlaylistQdnIdentifier(playlist.playlistId)),
    );
  });
});

describe('library reconstruction', () => {
  beforeEach(() => {
    resetLibrary();
    resetPlaylistStore();
    mockedPublish.mockReset();
    mockedSearch.mockReset();
    mockedFetch.mockReset();
  });

  it('reconstructs every discovered track, not only the newest', async () => {
    const tracks = [makeTrack(0), makeTrack(1), makeTrack(2)];
    const resources = tracks.map((track) => trackResource(track.trackId));

    mockedSearch.mockResolvedValue(resources);

    mockedFetch.mockImplementation(async (ref) => {
      const track = tracks.find(
        (candidate) => getTrackQdnIdentifier(candidate.trackId) === ref.identifier,
      );

      if (!track) throw new Error(`Unexpected fetch: ${ref.service}/${ref.name}/${ref.identifier}`);

      const index = tracks.indexOf(track);
      return trackPayload(track.trackId, index);
    });

    await loadLibrary(OWNER_NAME, OWNER_ADDRESS);

    expect(getLibraryTracks().map((track) => track.trackId)).toEqual(
      tracks.map((track) => track.trackId),
    );
  });

  it('deduplicates repeated identifiers without dropping distinct tracks', async () => {
    const tracks = [makeTrack(0), makeTrack(1)];
    const resources = [
      trackResource(tracks[0].trackId),
      trackResource(tracks[0].trackId),
      trackResource(tracks[1].trackId),
    ];

    mockedSearch.mockResolvedValue(resources);
    mockedFetch.mockImplementation(async (ref) => {
      const track = tracks.find(
        (candidate) => getTrackQdnIdentifier(candidate.trackId) === ref.identifier,
      );

      if (!track) throw new Error(`Unexpected fetch: ${ref.identifier}`);

      const index = tracks.indexOf(track);
      return trackPayload(track.trackId, index);
    });

    await loadLibrary(OWNER_NAME, OWNER_ADDRESS);

    expect(getLibraryTracks().map((track) => track.trackId)).toEqual([
      tracks[0].trackId,
      tracks[1].trackId,
    ]);
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });
});

describe('playlist reconstruction', () => {
  beforeEach(() => {
    resetLibrary();
    resetPlaylistStore();
    mockedPublish.mockReset();
    mockedSearch.mockReset();
    mockedFetch.mockReset();
    mockedPublish.mockResolvedValue({ accepted: true } as never);
  });

  it('reconstructs every discovered logical playlist', async () => {
    const playlists = [
      { playlistId: 'p-1', index: 0 },
      { playlistId: 'p-2', index: 1 },
      { playlistId: 'p-3', index: 2 },
    ];

    mockedSearch.mockImplementation(async (params) => {
      if (params.service === 'PLAYLIST') {
        return playlists.map((playlist) => playlistResource(playlist.playlistId));
      }

      return [];
    });

    mockedFetch.mockImplementation(async (ref) => {
      const playlist = playlists.find(
        (candidate) => getPlaylistQdnIdentifier(candidate.playlistId) === ref.identifier,
      );

      if (!playlist) throw new Error(`Unexpected fetch: ${ref.identifier}`);

      return playlistPayload(playlist.playlistId, playlist.index);
    });

    await loadPlaylistStore(OWNER_NAME, OWNER_ADDRESS);

    expect(getPlaylists().map((playlist) => playlist.playlistId)).toEqual(['p-1', 'p-2', 'p-3']);
  });

  it('keeps logical playlist and version resources in separate namespaces', async () => {
    const playlistId = 'playlist-1';

    mockedPublish.mockResolvedValue({ accepted: true } as never);
    mockedSearch.mockImplementation(async (params) => {
      if (params.service === 'PLAYLIST' && params.name === OWNER_NAME) {
        return [playlistResource(playlistId)];
      }

      return [];
    });
    mockedFetch.mockImplementation(async (ref) => {
      if (ref.service === 'PLAYLIST') {
        return playlistPayload(playlistId, 1);
      }

      throw new Error(`Unexpected fetch: ${ref.identifier}`);
    });

    await loadPlaylistStore(OWNER_NAME, OWNER_ADDRESS);

    const result = await publishPlaylistVersion(
      {
        playlistId,
        createdBy: OWNER_ADDRESS,
        tracks: [{ trackId: 'track-1', durationMs: 1000 }],
      },
      OWNER_NAME,
    );

    expect(result.ok).toBe(true);

    const publishCalls = mockedPublish.mock.calls.map(
      ([call]) =>
        call as unknown as {
          service?: string;
          identifier?: string;
        },
    );

    expect(publishCalls).toContainEqual(
      expect.objectContaining({
        service: 'JSON',
        identifier: getPlaylistVersionQdnIdentifier(
          result.ok ? result.version.versionId : 'unreachable',
        ),
      }),
    );
    expect(publishCalls).toContainEqual(
      expect.objectContaining({
        service: 'PLAYLIST',
        identifier: getPlaylistQdnIdentifier(playlistId),
      }),
    );

    expect(
      getPlaylists().find((playlist) => playlist.playlistId === playlistId)?.latestVersionId,
    ).toBe(result.ok ? result.version.versionId : '');
  });
});

describe('reload equivalence', () => {
  beforeEach(() => {
    resetLibrary();
    resetPlaylistStore();
    mockedPublish.mockReset();
    mockedSearch.mockReset();
    mockedFetch.mockReset();
    mockedPublish.mockResolvedValue({ accepted: true } as never);
  });

  it('rebuilds the same session-visible track list from QDN search results', async () => {
    const tracks = [makeTrack(0), makeTrack(1)];

    for (const track of tracks) {
      await addTrackToLibrary(track, OWNER_NAME);
    }

    const sessionTrackIds = getLibraryTracks().map((track) => track.trackId);

    resetLibrary();
    mockedSearch.mockResolvedValue(tracks.map((track) => trackResource(track.trackId)));
    mockedFetch.mockImplementation(async (ref) => {
      const track = tracks.find(
        (candidate) => getTrackQdnIdentifier(candidate.trackId) === ref.identifier,
      );

      if (!track) throw new Error(`Unexpected fetch: ${ref.identifier}`);

      const index = tracks.indexOf(track);
      return trackPayload(track.trackId, index);
    });

    await loadLibrary(OWNER_NAME, OWNER_ADDRESS);

    expect(getLibraryTracks().map((track) => track.trackId)).toEqual(sessionTrackIds);
  });
});
