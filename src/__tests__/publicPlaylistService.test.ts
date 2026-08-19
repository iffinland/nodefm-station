/* ============================================================
 * NodeFM Station — Public Playlist Service Tests
 *
 * Confirms the public Playlists page data path stays read-only,
 * deduplicates discovery results, and excludes private playlists.
 * ============================================================ */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../qortium/qdn', () => ({
  searchQdnResources: vi.fn(),
  fetchQdnResourceData: vi.fn(),
}));

import { searchQdnResources, fetchQdnResourceData } from '../qortium/qdn';
import { loadPublicPlaylists } from '../features/playlists/services/publicPlaylistService';

const mockedSearch = vi.mocked(searchQdnResources);
const mockedFetch = vi.mocked(fetchQdnResourceData);

function playlist(playlistId: string, title: string, visibility: 'public' | 'private') {
  return {
    playlistId,
    ownerAddress: 'Q-owner',
    title,
    visibility,
    latestVersionId: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('public playlist discovery', () => {
  beforeEach(() => {
    mockedSearch.mockReset();
    mockedFetch.mockReset();
  });

  it('returns only public playlists and sorts them by title', async () => {
    mockedSearch.mockResolvedValue([
      { service: 'PLAYLIST', name: 'Owner A', identifier: 'nodefm-playlist-a' },
      { service: 'PLAYLIST', name: 'Owner B', identifier: 'nodefm-playlist-b' },
      { service: 'PLAYLIST', name: 'Owner A', identifier: 'nodefm-playlist-a' },
      { service: 'PLAYLIST', name: 'Owner C', identifier: 'nodefm-playlist-c' },
    ]);

    mockedFetch.mockImplementation(async (ref) => {
      if (ref.identifier === 'nodefm-playlist-a') {
        return playlist('a', 'Alpha', 'public');
      }

      if (ref.identifier === 'nodefm-playlist-b') {
        return playlist('b', 'Beta', 'private');
      }

      if (ref.identifier === 'nodefm-playlist-c') {
        return playlist('c', 'Gamma', 'public');
      }

      throw new Error(`Unexpected fetch: ${String(ref.identifier)}`);
    });

    const result = await loadPublicPlaylists('Owner A');

    expect(result.map((item) => item.playlistId)).toEqual(['a', 'c']);
    expect(result.map((item) => item.title)).toEqual(['Alpha', 'Gamma']);
    expect(mockedFetch).toHaveBeenCalledTimes(3);
    expect(mockedSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        service: 'PLAYLIST',
        name: 'Owner A',
        query: 'nodefm-playlist-',
        prefix: true,
      }),
    );
  });

  it('skips resources that cannot be fetched or deserialized', async () => {
    mockedSearch.mockResolvedValue([
      { service: 'PLAYLIST', name: 'Owner', identifier: 'nodefm-playlist-a' },
      { service: 'PLAYLIST', name: 'Owner', identifier: 'nodefm-playlist-b' },
    ]);

    mockedFetch.mockImplementation(async (ref) => {
      if (ref.identifier === 'nodefm-playlist-a') {
        return playlist('a', 'Alpha', 'public');
      }

      throw new Error('missing');
    });

    await expect(loadPublicPlaylists('Owner')).resolves.toEqual([
      expect.objectContaining({ playlistId: 'a', publisherName: 'Owner' }),
    ]);
  });

  it('returns an empty list when no station publisher is known', async () => {
    await expect(loadPublicPlaylists()).resolves.toEqual([]);
    expect(mockedSearch).not.toHaveBeenCalled();
  });
});
