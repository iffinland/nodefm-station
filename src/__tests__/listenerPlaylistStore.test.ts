/* ============================================================
 * NodeFM Station — Listener Playlist Store Tests
 * ============================================================ */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../qortium/qdn', () => ({
  fetchQdnResourceData: vi.fn(),
  publishMultipleResources: vi.fn(),
  publishResource: vi.fn(),
  searchQdnResources: vi.fn(),
}));

vi.mock('../qortium/qdnReadError', async () => {
  const actual =
    await vi.importActual<typeof import('../qortium/qdnReadError')>('../qortium/qdnReadError');

  return {
    ...actual,
    isConfirmedQdnNotFoundError: vi.fn(() => false),
    getQdnResourceReadErrorCode: vi.fn(() => 'UNAVAILABLE'),
  };
});

import { publishMultipleResources, searchQdnResources } from '../qortium/qdn';
import {
  loadListenerPlaylists,
  publishListenerPlaylist,
  resetListenerPlaylistStore,
  getListenerPlaylists,
  getListenerPlaylistVersions,
  getListenerPlaylistLoadAction,
} from '../features/listener-playlists/services/listenerPlaylistStore';
import { createListenerPlaylistDraft } from '../features/listener-playlists/services/listenerPlaylistService';

const mockedBatchPublish = vi.mocked(publishMultipleResources);
const mockedSearch = vi.mocked(searchQdnResources);

describe('listenerPlaylistStore', () => {
  beforeEach(() => {
    resetListenerPlaylistStore();
    mockedBatchPublish.mockReset();
    mockedSearch.mockReset();
    mockedBatchPublish.mockImplementation(async (resources) => ({
      accepted: true,
      action: 'PUBLISH_MULTIPLE_QDN_RESOURCES',
      published: resources.map((resource) => ({
        result: {},
        resource: {
          identifier: resource.identifier ?? null,
          name: resource.name,
          service: resource.service,
        },
        transactionSignature: 'signature',
      })),
      failures: [],
    }));
  });

  it('loads playlists for only the selected registered name/account', async () => {
    mockedSearch.mockImplementation(async (params) => {
      if (params.name !== 'listener-a') return [];
      return [
        {
          service: 'PLAYLIST',
          name: 'listener-a',
          identifier: 'nodefm-listener-playlist-p1',
        },
      ];
    });

    await loadListenerPlaylists('listener-a', 'Q-listener-a');
    expect(getListenerPlaylists()).toHaveLength(0);
    expect(getListenerPlaylistLoadAction('listener-a', 'Q-listener-a')).toBe('reuse');
    expect(getListenerPlaylistLoadAction('listener-b', 'Q-listener-a')).toBe('load');
  });

  it('publishes listener playlist under the listener name, not the station name', async () => {
    const draft = createListenerPlaylistDraft({
      playlistId: 'p1',
      title: 'Forest Night',
      ownerName: 'listener-a',
      ownerAddress: 'Q-listener-a',
    });

    const result = await publishListenerPlaylist(draft, [
      { trackId: 'track-1', durationMs: 60000 },
    ]);

    expect(result.ok).toBe(true);
    expect(mockedBatchPublish).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          service: 'PLAYLIST',
          name: 'listener-a',
          identifier: 'nodefm-listener-playlist-p1',
        }),
      ]),
    );
    expect(mockedBatchPublish).not.toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'NodeFM',
      }),
    );
  });

  it('publishes an empty-title draft as the visible Untitled Playlist fallback', async () => {
    const draft = createListenerPlaylistDraft({
      playlistId: 'p1',
      title: '',
      ownerName: 'listener-a',
      ownerAddress: 'Q-listener-a',
    });

    const result = await publishListenerPlaylist(draft, [
      { trackId: 'track-1', durationMs: 60000 },
    ]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.playlist.title).toBe('Untitled Playlist');
    }
  });

  it('keeps old account data from leaking into a new account scope', async () => {
    mockedSearch.mockResolvedValue([]);
    await loadListenerPlaylists('listener-a', 'Q-listener-a');

    const draft = createListenerPlaylistDraft({
      playlistId: 'p1',
      title: 'A Playlist',
      ownerName: 'listener-a',
      ownerAddress: 'Q-listener-a',
    });
    await publishListenerPlaylist(draft, [{ trackId: 'track-1', durationMs: 1000 }]);
    expect(getListenerPlaylists()).toHaveLength(1);

    resetListenerPlaylistStore();
    await loadListenerPlaylists('listener-b', 'Q-listener-b');
    expect(getListenerPlaylists()).toHaveLength(0);
  });

  it('creates immutable versions with distinct version IDs', async () => {
    const draft = createListenerPlaylistDraft({
      playlistId: 'p1',
      title: 'Versions',
      ownerName: 'listener-a',
      ownerAddress: 'Q-listener-a',
    });

    const first = await publishListenerPlaylist(draft, [{ trackId: 'track-1', durationMs: 1000 }]);
    if (!first.ok || !('version' in first)) throw new Error('Expected first version');

    const second = await publishListenerPlaylist(
      draft,
      [
        { trackId: 'track-1', durationMs: 1000 },
        { trackId: 'track-2', durationMs: 2000 },
      ],
      first.version,
    );

    expect(second.ok).toBe(true);
    if (!second.ok || !('version' in second)) return;
    expect(second.version.versionId).not.toBe(first.version.versionId);
    expect(getListenerPlaylistVersions('p1')).toHaveLength(2);
  });
});
