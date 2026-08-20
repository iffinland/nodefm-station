/* ============================================================
 * NodeFM Station — Partial QDN Reconstruction Tests
 *
 * Confirms library/playlist stores preserve valid resources while
 * explicitly marking incomplete/degraded reconstruction. Confirmed
 * absence remains distinct from transient unavailability.
 * ============================================================ */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../qortium/qdn', () => ({
  searchQdnResources: vi.fn(),
  fetchQdnResourceData: vi.fn(),
  publishResource: vi.fn(),
  deleteQdnResource: vi.fn(),
}));

import { searchQdnResources, fetchQdnResourceData } from '../qortium/qdn';
import {
  getLibraryDiagnostics,
  getLibraryIncomplete,
  getLibraryTracks,
  loadLibrary,
  resetLibrary,
} from '../features/library/services/libraryService';
import {
  getPlaylists,
  getStoreDiagnostics,
  getStoreIncomplete,
  loadPlaylistStore,
  resetPlaylistStore,
} from '../features/playlists/services/playlistStore';

const mockedSearch = vi.mocked(searchQdnResources);
const mockedFetch = vi.mocked(fetchQdnResourceData);

const OWNER_NAME = 'Owner';
const OWNER_ADDRESS = 'Q-owner';

function trackPayload(trackId: string) {
  return {
    trackId,
    ownerAddress: OWNER_ADDRESS,
    title: `Track ${trackId}`,
    audio: { service: 'AUDIO', name: OWNER_NAME, identifier: `${trackId}-audio` },
    durationMs: 1000,
    source: 'station-upload',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function playlistPayload(playlistId: string) {
  return {
    playlistId,
    ownerAddress: OWNER_ADDRESS,
    title: `Playlist ${playlistId}`,
    visibility: 'public',
    latestVersionId: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function versionPayload(playlistId: string, versionId: string) {
  return {
    playlistId,
    versionId,
    versionNumber: 1,
    createdBy: OWNER_ADDRESS,
    createdAt: '2026-01-01T00:00:00.000Z',
    tracks: [{ trackId: 'track-1', durationMs: 1000 }],
    totalDurationMs: 1000,
  };
}

describe('library partial reconstruction', () => {
  beforeEach(() => {
    resetLibrary();
    mockedSearch.mockReset();
    mockedFetch.mockReset();
  });

  it('keeps valid tracks and marks incomplete when one fetch is unavailable', async () => {
    mockedSearch.mockResolvedValue([
      { service: 'JSON', name: OWNER_NAME, identifier: 'nodefm-track-good' },
      { service: 'JSON', name: OWNER_NAME, identifier: 'nodefm-track-bad' },
    ]);
    mockedFetch.mockImplementation(async (ref) => {
      if (ref.identifier === 'nodefm-track-bad') {
        throw new Error('network exploded');
      }

      return trackPayload(String(ref.identifier).slice('nodefm-track-'.length));
    });

    await loadLibrary(OWNER_NAME, OWNER_ADDRESS);

    expect(getLibraryTracks().map((track) => track.trackId)).toEqual(['good']);
    expect(getLibraryIncomplete()).toBe(true);
    expect(getLibraryDiagnostics()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          identifier: 'nodefm-track-bad',
          code: 'RESOURCE_UNAVAILABLE',
        }),
      ]),
    );
  });

  it('treats confirmed not-found as absence rather than incomplete data', async () => {
    mockedSearch.mockResolvedValue([
      { service: 'JSON', name: OWNER_NAME, identifier: 'nodefm-track-good' },
      { service: 'JSON', name: OWNER_NAME, identifier: 'nodefm-track-gone' },
    ]);
    mockedFetch.mockImplementation(async (ref) => {
      if (ref.identifier === 'nodefm-track-gone') {
        throw new Error('resource does not exist');
      }

      return trackPayload(String(ref.identifier).slice('nodefm-track-'.length));
    });

    await loadLibrary(OWNER_NAME, OWNER_ADDRESS);

    expect(getLibraryTracks().map((track) => track.trackId)).toEqual(['good']);
    expect(getLibraryIncomplete()).toBe(false);
    expect(getLibraryDiagnostics().some((item) => item.code === 'RESOURCE_NOT_FOUND')).toBe(true);
  });
});

describe('playlist store partial reconstruction', () => {
  beforeEach(() => {
    resetPlaylistStore();
    mockedSearch.mockReset();
    mockedFetch.mockReset();
  });

  it('keeps valid playlists and marks incomplete when a version is unavailable', async () => {
    mockedSearch.mockImplementation(async (params) => {
      if (params.service === 'PLAYLIST') {
        return [{ service: 'PLAYLIST', name: OWNER_NAME, identifier: 'nodefm-playlist-p1' }];
      }

      return [
        { service: 'JSON', name: OWNER_NAME, identifier: 'nodefm-playlist-version-v1' },
        { service: 'JSON', name: OWNER_NAME, identifier: 'nodefm-playlist-version-v2' },
      ];
    });
    mockedFetch.mockImplementation(async (ref) => {
      if (ref.identifier === 'nodefm-playlist-p1') {
        return playlistPayload('p1');
      }

      if (ref.identifier === 'nodefm-playlist-version-v1') {
        return versionPayload('p1', 'v1');
      }

      throw new Error('version unavailable');
    });

    await loadPlaylistStore(OWNER_NAME, OWNER_ADDRESS);

    expect(getPlaylists().map((playlist) => playlist.playlistId)).toEqual(['p1']);
    expect(getStoreIncomplete()).toBe(true);
    expect(getStoreDiagnostics()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          identifier: 'nodefm-playlist-version-v2',
          kind: 'version',
          code: 'RESOURCE_UNAVAILABLE',
        }),
      ]),
    );
  });

  it('marks a genuinely empty store complete', async () => {
    mockedSearch.mockResolvedValue([]);

    await loadPlaylistStore(OWNER_NAME, OWNER_ADDRESS);

    expect(getPlaylists()).toEqual([]);
    expect(getStoreIncomplete()).toBe(false);
    expect(getStoreDiagnostics()).toEqual([]);
  });
});
