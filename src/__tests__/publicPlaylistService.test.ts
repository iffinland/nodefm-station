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
      { service: 'PLAYLIST', name: 'Owner A', identifier: 'nodefm-playlist-c' },
    ]);

    mockedFetch.mockImplementation(async (ref) => {
      if (ref.identifier === 'nodefm-playlist-a') {
        return {
          ...playlist('a', 'Alpha', 'public'),
          latestVersionId: 'va',
        };
      }

      if (ref.identifier === 'nodefm-playlist-version-va') {
        return {
          playlistId: 'a',
          versionId: 'va',
          versionNumber: 1,
          createdBy: 'Owner A',
          createdAt: '2026-01-01T00:00:00.000Z',
          tracks: [{ trackId: 'ta', durationMs: 1000 }],
          totalDurationMs: 1000,
        };
      }

      if (ref.identifier === 'nodefm-playlist-b') {
        return playlist('b', 'Beta', 'private');
      }

      if (ref.identifier === 'nodefm-playlist-c') {
        return {
          ...playlist('c', 'Gamma', 'public'),
          latestVersionId: 'vc',
        };
      }

      if (ref.identifier === 'nodefm-playlist-version-vc') {
        return {
          playlistId: 'c',
          versionId: 'vc',
          versionNumber: 1,
          createdBy: 'Owner A',
          createdAt: '2026-01-01T00:00:00.000Z',
          tracks: [
            { trackId: 'tc1', durationMs: 1000 },
            { trackId: 'tc2', durationMs: 2000 },
          ],
          totalDurationMs: 3000,
        };
      }

      throw new Error(`Unexpected fetch: ${String(ref.identifier)}`);
    });

    const result = await loadPublicPlaylists('Owner A');

    expect(result.status).toBe('complete');
    expect(result.playlists.map((item) => item.playlistId)).toEqual(['a', 'c']);
    expect(result.playlists.map((item) => item.title)).toEqual(['Alpha', 'Gamma']);
    expect(mockedFetch).toHaveBeenCalledTimes(4);
    expect(mockedSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        service: 'PLAYLIST',
        name: 'Owner A',
        query: 'nodefm-playlist-',
        prefix: true,
        mode: 'ALL',
      }),
    );
    expect(result.playlists[0].trackCount).toBe(1);
    expect(result.playlists[0].totalDurationMs).toBe(1000);
    expect(result.playlists[1].trackCount).toBe(2);
    expect(result.playlists[1].totalDurationMs).toBe(3000);
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

    const result = await loadPublicPlaylists('Owner');
    expect(result.status).toBe('incomplete');
    expect(result.playlists).toEqual([
      expect.objectContaining({ playlistId: 'a', publisherName: 'Owner' }),
    ]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it('returns an empty list when no station publisher is known', async () => {
    await expect(loadPublicPlaylists()).resolves.toEqual({
      status: 'complete',
      playlists: [],
      diagnostics: [],
    });
    expect(mockedSearch).not.toHaveBeenCalled();
  });
});
