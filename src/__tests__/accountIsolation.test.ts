/* ============================================================
 * NodeFM Station — Account Isolation Tests
 *
 * Verifies library/playlist stores reset on account change and
 * that stale async loads cannot overwrite the new account state.
 * ============================================================ */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../qortium/qdn', () => ({
  searchQdnResources: vi.fn(),
  fetchQdnResourceData: vi.fn(),
  publishResource: vi.fn(),
  deleteQdnResource: vi.fn(),
}));

import { searchQdnResources, fetchQdnResourceData } from '../qortium/qdn';
import {
  getLibraryLoadAction,
  getLibraryTracks,
  loadLibrary,
  resetLibrary,
} from '../features/library/services/libraryService';
import {
  getPlaylists,
  getStoreLoadAction,
  loadPlaylistStore,
  resetPlaylistStore,
} from '../features/playlists/services/playlistStore';

const mockedSearch = vi.mocked(searchQdnResources);
const mockedFetch = vi.mocked(fetchQdnResourceData);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

function trackPayload(trackId: string, ownerAddress: string, title: string) {
  return {
    trackId,
    ownerAddress,
    title,
    audio: { service: 'AUDIO', name: ownerAddress, identifier: `${trackId}-audio` },
    durationMs: 1000,
    source: 'qdn-existing',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function playlistPayload(playlistId: string, ownerAddress: string, title: string) {
  return {
    playlistId,
    ownerAddress,
    title,
    visibility: 'private',
    latestVersionId: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('library account isolation', () => {
  beforeEach(() => {
    resetLibrary();
    mockedSearch.mockReset();
    mockedFetch.mockReset();
  });

  it('isolates account A from account B on switch', async () => {
    mockedSearch.mockImplementation(async (params) => {
      if (params.name === 'A') {
        return [{ service: 'JSON', name: 'A', identifier: 'nodefm-track-a1' }];
      }

      if (params.name === 'B') {
        return [{ service: 'JSON', name: 'B', identifier: 'nodefm-track-b1' }];
      }

      return [];
    });

    mockedFetch.mockImplementation(async (ref) => {
      if (ref.name === 'A' && ref.identifier === 'nodefm-track-a1') {
        return trackPayload('a1', 'addrA', 'A Track');
      }

      if (ref.name === 'B' && ref.identifier === 'nodefm-track-b1') {
        return trackPayload('b1', 'addrB', 'B Track');
      }

      throw new Error(`unexpected fetch: ${ref.name}/${ref.identifier}`);
    });

    await loadLibrary('A', 'addrA');
    expect(getLibraryTracks().map((t) => t.trackId)).toEqual(['a1']);

    resetLibrary();
    expect(getLibraryTracks()).toEqual([]);

    await loadLibrary('B', 'addrB');
    expect(getLibraryTracks().map((t) => t.trackId)).toEqual(['b1']);
  });

  it('does not let a stale account A response overwrite account B state', async () => {
    const aFetch = deferred<unknown>();

    mockedSearch.mockImplementation(async (params) => {
      if (params.name === 'A') {
        return [{ service: 'JSON', name: 'A', identifier: 'nodefm-track-a1' }];
      }

      if (params.name === 'B') {
        return [{ service: 'JSON', name: 'B', identifier: 'nodefm-track-b1' }];
      }

      return [];
    });

    mockedFetch.mockImplementation((ref) => {
      if (ref.name === 'A' && ref.identifier === 'nodefm-track-a1') {
        return aFetch.promise;
      }

      if (ref.name === 'B' && ref.identifier === 'nodefm-track-b1') {
        return Promise.resolve(trackPayload('b1', 'addrB', 'B Track'));
      }

      return Promise.reject(new Error(`unexpected fetch: ${ref.name}/${ref.identifier}`));
    });

    const aLoad = loadLibrary('A', 'addrA');
    resetLibrary();

    await loadLibrary('B', 'addrB');
    expect(getLibraryTracks().map((t) => t.trackId)).toEqual(['b1']);

    aFetch.resolve(trackPayload('a1', 'addrA', 'A Track'));
    await aLoad;

    expect(getLibraryTracks().map((t) => t.trackId)).toEqual(['b1']);
  });
});

describe('playlist account isolation', () => {
  beforeEach(() => {
    resetPlaylistStore();
    mockedSearch.mockReset();
    mockedFetch.mockReset();
  });

  it('does not expose account A playlists to account B', async () => {
    mockedSearch.mockImplementation(async (params) => {
      if (params.service === 'PLAYLIST') {
        if (params.name === 'A') {
          return [{ service: 'PLAYLIST', name: 'A', identifier: 'nodefm-playlist-p1' }];
        }

        if (params.name === 'B') {
          return [{ service: 'PLAYLIST', name: 'B', identifier: 'nodefm-playlist-p2' }];
        }
      }

      // No versions for this test.
      return [];
    });

    mockedFetch.mockImplementation(async (ref) => {
      if (
        ref.service === 'PLAYLIST' &&
        ref.name === 'A' &&
        ref.identifier === 'nodefm-playlist-p1'
      ) {
        return playlistPayload('p1', 'addrA', 'A Playlist');
      }

      if (
        ref.service === 'PLAYLIST' &&
        ref.name === 'B' &&
        ref.identifier === 'nodefm-playlist-p2'
      ) {
        return playlistPayload('p2', 'addrB', 'B Playlist');
      }

      throw new Error(`unexpected fetch: ${ref.name}/${ref.identifier}`);
    });

    await loadPlaylistStore('A', 'addrA');
    expect(getPlaylists().map((p) => p.playlistId)).toEqual(['p1']);

    resetPlaylistStore();
    expect(getPlaylists()).toEqual([]);

    await loadPlaylistStore('B', 'addrB');
    expect(getPlaylists().map((p) => p.playlistId)).toEqual(['p2']);
  });
});

describe('same-account mount reuse', () => {
  beforeEach(() => {
    resetLibrary();
    resetPlaylistStore();
    mockedSearch.mockReset();
    mockedFetch.mockReset();
  });

  it('reuses an already-loaded library for the same account instead of resetting', async () => {
    mockedSearch.mockResolvedValue([{ service: 'JSON', name: 'A', identifier: 'nodefm-track-a1' }]);
    mockedFetch.mockResolvedValue(trackPayload('a1', 'addrA', 'A Track'));

    expect(getLibraryLoadAction('A', 'addrA')).toBe('load');
    await loadLibrary('A', 'addrA');

    expect(getLibraryLoadAction('A', 'addrA')).toBe('reuse');
    expect(getLibraryLoadAction('B', 'addrB')).toBe('load');
    expect(getLibraryLoadAction(null, 'addrA')).toBe('clear');
  });

  it('reuses an already-loaded playlist store for the same account', async () => {
    mockedSearch.mockImplementation(async (params) => {
      if (params.service === 'PLAYLIST' && params.name === 'A') {
        return [{ service: 'PLAYLIST', name: 'A', identifier: 'nodefm-playlist-p1' }];
      }

      return [];
    });
    mockedFetch.mockResolvedValue(playlistPayload('p1', 'addrA', 'A Playlist'));

    expect(getStoreLoadAction('A', 'addrA')).toBe('load');
    await loadPlaylistStore('A', 'addrA');

    expect(getStoreLoadAction('A', 'addrA')).toBe('reuse');
    expect(getStoreLoadAction('B', 'addrB')).toBe('load');
    expect(getStoreLoadAction(null, 'addrA')).toBe('clear');
  });
});
