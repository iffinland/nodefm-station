/* ============================================================
 * NodeFM Station — Public Playlist Detail Tests
 *
 * Covers immutable version reconstruction, private exclusion,
 * missing/malformed version isolation, exact track order, and
 * audio resolution failures.
 * ============================================================ */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../qortium/qdn', () => ({
  fetchQdnResourceData: vi.fn(),
  searchQdnResources: vi.fn(),
  ensureQdnResourceReady: vi.fn(),
  getQdnResourceUrl: vi.fn(),
}));

import { fetchQdnResourceData, ensureQdnResourceReady, getQdnResourceUrl } from '../qortium/qdn';
import {
  loadPublicPlaylistDetail,
  resolvePublicPlaylistAudioTracks,
} from '../features/playlists/services/publicPlaylistService';
import type { Playlist, PlaylistVersion, Track } from '../types/domain';

const mockedFetch = vi.mocked(fetchQdnResourceData);
const mockedEnsureReady = vi.mocked(ensureQdnResourceReady);
const mockedGetUrl = vi.mocked(getQdnResourceUrl);

function playlist(overrides: Partial<Playlist> = {}): Playlist {
  return {
    schemaVersion: 1,
    playlistId: 'p1',
    ownerAddress: 'Q-owner',
    title: 'Public Mix',
    description: 'Public mix description',
    visibility: 'public',
    latestVersionId: 'v1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function version(overrides: Partial<PlaylistVersion> = {}): PlaylistVersion {
  return {
    schemaVersion: 1,
    playlistId: 'p1',
    versionId: 'v1',
    versionNumber: 1,
    createdBy: 'Q-owner',
    createdAt: '2026-01-01T00:00:00.000Z',
    tracks: [
      { trackId: 't1', durationMs: 1000 },
      { trackId: 't2', durationMs: 2000 },
    ],
    totalDurationMs: 3000,
    ...overrides,
  };
}

function track(trackId: string, title: string): Track {
  return {
    schemaVersion: 1,
    trackId,
    ownerAddress: 'Q-owner',
    title,
    audio: { service: 'AUDIO', name: 'Owner', identifier: `${trackId}-audio` },
    durationMs: trackId === 't1' ? 1000 : 2000,
    source: 'station-upload',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('loadPublicPlaylistDetail', () => {
  beforeEach(() => {
    mockedFetch.mockReset();
    mockedEnsureReady.mockReset();
    mockedGetUrl.mockReset();
    mockedEnsureReady.mockResolvedValue(undefined);
    mockedGetUrl.mockResolvedValue('/render/audio');
  });

  it('reconstructs an immutable version and preserves exact track order', async () => {
    mockedFetch.mockImplementation(async (ref) => {
      if (ref.identifier === 'nodefm-playlist-p1') {
        return playlist();
      }

      if (ref.identifier === 'nodefm-playlist-version-v1') {
        return version();
      }

      if (ref.identifier === 'nodefm-track-t1') {
        return track('t1', 'First');
      }

      if (ref.identifier === 'nodefm-track-t2') {
        return track('t2', 'Second');
      }

      throw new Error(`Unexpected fetch: ${String(ref.identifier)}`);
    });

    const result = await loadPublicPlaylistDetail('Owner', 'p1');

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;

    expect(result.detail.playlist.playlistId).toBe('p1');
    expect(result.detail.version.versionId).toBe('v1');
    expect(result.detail.tracks.map((entry) => entry.track.trackId)).toEqual(['t1', 't2']);
    expect(result.detail.tracks.map((entry) => entry.track.title)).toEqual(['First', 'Second']);
  });

  it('does not expose a private playlist', async () => {
    mockedFetch.mockResolvedValue(playlist({ visibility: 'private' }));

    await expect(loadPublicPlaylistDetail('Owner', 'p1')).resolves.toMatchObject({
      status: 'private',
    });
  });

  it('returns version-missing when the logical playlist has no version pointer', async () => {
    mockedFetch.mockResolvedValue(playlist({ latestVersionId: '' }));

    await expect(loadPublicPlaylistDetail('Owner', 'p1')).resolves.toMatchObject({
      status: 'version-missing',
    });
  });

  it('returns version-malformed when the published version is invalid', async () => {
    mockedFetch.mockImplementation(async (ref) => {
      if (ref.identifier === 'nodefm-playlist-p1') {
        return playlist();
      }

      return version({ playlistId: 'other-playlist' });
    });

    await expect(loadPublicPlaylistDetail('Owner', 'p1')).resolves.toMatchObject({
      status: 'version-malformed',
    });
  });

  it('reports missing tracks instead of silently reordering them', async () => {
    mockedFetch.mockImplementation(async (ref) => {
      if (ref.identifier === 'nodefm-playlist-p1') {
        return playlist();
      }

      if (ref.identifier === 'nodefm-playlist-version-v1') {
        return version();
      }

      if (ref.identifier === 'nodefm-track-t1') {
        return track('t1', 'First');
      }

      throw new Error('track t2 missing');
    });

    const result = await loadPublicPlaylistDetail('Owner', 'p1');

    expect(result.status).toBe('tracks-unavailable');
    if (result.status !== 'tracks-unavailable') return;
    expect(result.failedTrackIds).toEqual(['t2']);
  });
});

describe('resolvePublicPlaylistAudioTracks', () => {
  beforeEach(() => {
    mockedEnsureReady.mockReset();
    mockedGetUrl.mockReset();
  });

  it('resolves every track in order when audio is ready', async () => {
    mockedEnsureReady.mockResolvedValue(undefined);
    mockedGetUrl.mockImplementation(async (ref) => {
      return `/render/AUDIO/Owner/${String(ref.identifier)}`;
    });

    const result = await resolvePublicPlaylistAudioTracks([
      { track: track('t1', 'First') },
      { track: track('t2', 'Second') },
    ]);

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.tracks.map((item) => item.trackId)).toEqual(['t1', 't2']);
    expect(result.tracks[0].url).toContain('t1-audio');
    expect(result.tracks[1].url).toContain('t2-audio');
  });

  it('returns audio-unavailable with exact failed track metadata', async () => {
    mockedEnsureReady.mockImplementation(async (ref) => {
      if (ref.identifier === 't1-audio') {
        throw new Error('missing audio');
      }
    });
    mockedGetUrl.mockResolvedValue('/render/audio');

    const result = await resolvePublicPlaylistAudioTracks([
      { track: track('t1', 'First') },
      { track: track('t2', 'Second') },
    ]);

    expect(result.status).toBe('audio-unavailable');
    if (result.status !== 'audio-unavailable') return;
    expect(result.failed).toEqual([{ index: 0, trackId: 't1', title: 'First' }]);
  });
});
