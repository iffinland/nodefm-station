/* ============================================================
 * NodeFM Station — Listener Playlist Detail / Missing Track Tests
 * ============================================================ */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../qortium/qdn', () => ({
  qdnJsonPublishFileName: (identifier: string) => `${identifier}.json`,
  fetchQdnResourceData: vi.fn(),
}));

vi.mock('../features/radio/player/resolveTrackPlayback', () => ({
  resolveTrackPlayback: vi.fn(),
  resolveQdnCoverUrl: vi.fn(),
}));

import { fetchQdnResourceData } from '../qortium/qdn';
import { resolveTrackPlayback } from '../features/radio/player/resolveTrackPlayback';
import {
  loadListenerPlaylistDetail,
  resolveListenerPlaylistAudio,
  type ListenerPlaylistDetailTrack,
} from '../features/listener-playlists/services/listenerPlaylistDetailService';
import {
  createListenerTrackSubmission,
  getSubmissionAudioQdnIdentifier,
  getSubmissionQdnIdentifier,
} from '../features/listener-submissions/services/submissionService';

const mockedFetch = vi.mocked(fetchQdnResourceData);
const mockedResolve = vi.mocked(resolveTrackPlayback);

function track(id: string, durationMs = 1000): ListenerPlaylistDetailTrack {
  return {
    track: {
      schemaVersion: 1,
      trackId: id,
      ownerAddress: 'Q-owner',
      title: `Track ${id}`,
      audio: { service: 'AUDIO', name: 'NodeFM', identifier: `audio-${id}` },
      durationMs,
      source: 'qdn-existing',
      createdAt: '2026-08-29T00:00:00.000Z',
      updatedAt: '2026-08-29T00:00:00.000Z',
    },
  };
}

describe('listener playlist detail', () => {
  beforeEach(() => {
    mockedFetch.mockReset();
    mockedResolve.mockReset();
  });

  it('reports missing canonical tracks without deleting immutable version entries', async () => {
    mockedFetch.mockImplementation(async (ref) => {
      if (ref.identifier === 'nodefm-listener-playlist-p1') {
        return {
          playlistId: 'p1',
          ownerAddress: 'Q-listener-a',
          title: 'Forest Night',
          visibility: 'private',
          latestVersionId: 'v1',
        };
      }

      if (ref.identifier === 'nodefm-lp-ver-v1') {
        return {
          playlistId: 'p1',
          versionId: 'v1',
          versionNumber: 1,
          createdBy: 'Q-listener-a',
          createdAt: '2026-08-29T00:00:00.000Z',
          tracks: [
            { trackId: 't1', durationMs: 1000 },
            { trackId: 't2', durationMs: 2000 },
          ],
          totalDurationMs: 3000,
        };
      }

      if (ref.identifier === 'nodefm-track-t1') {
        return {
          trackId: 't1',
          ownerAddress: 'Q-owner',
          title: 'One',
          audio: { service: 'AUDIO', name: 'NodeFM' },
          durationMs: 1000,
          source: 'qdn-existing',
        };
      }

      throw new Error(`missing ${String(ref.identifier)}`);
    });

    const result = await loadListenerPlaylistDetail('listener-a', 'NodeFM', 'p1');
    expect(result.status).toBe('tracks-unavailable');
    if (result.status === 'tracks-unavailable') {
      expect(result.version.tracks).toHaveLength(2);
      expect(result.failedTrackIds).toEqual(['t2']);
    }
  });

  it('skips unavailable audio tracks and returns the remaining queue', async () => {
    mockedResolve.mockImplementation(async (entry) => {
      if (entry.trackId === 't2') throw new Error('unavailable');
      return { audioUrl: `https://audio/${entry.trackId}` };
    });

    const resolution = await resolveListenerPlaylistAudio([track('t1'), track('t2'), track('t3')]);

    expect(resolution.missing).toEqual([{ index: 1, trackId: 't2', title: 'Track t2' }]);
    expect(resolution.tracks.map((audio) => audio.trackId)).toEqual(['t1', 't3']);
  });

  it('resolves owner-listener tracks from the immutable submission resource', async () => {
    mockedFetch.mockImplementation(async (ref) => {
      if (ref.identifier === 'nodefm-listener-playlist-p1') {
        return {
          playlistId: 'p1',
          ownerAddress: 'Q-listener-a',
          title: 'Own Mix',
          visibility: 'private',
          latestVersionId: 'v1',
        };
      }

      if (ref.identifier === 'nodefm-lp-ver-v1') {
        return {
          playlistId: 'p1',
          versionId: 'v1',
          versionNumber: 1,
          createdBy: 'Q-listener-a',
          createdAt: '2026-08-29T00:00:00.000Z',
          tracks: [
            {
              trackId: 'sub-1',
              durationMs: 120_000,
              kind: 'OWNER_TRACK',
              ownerName: 'listener-a',
            },
          ],
          totalDurationMs: 120_000,
        };
      }

      if (ref.identifier === getSubmissionQdnIdentifier('sub-1')) {
        return createListenerTrackSubmission({
          submissionId: 'sub-1',
          submitterName: 'listener-a',
          submitterAddress: 'Q-listener-a',
          title: 'My Song',
          audio: {
            service: 'AUDIO',
            name: 'listener-a',
            identifier: getSubmissionAudioQdnIdentifier('sub-1'),
          },
          durationMs: 120_000,
        });
      }

      throw new Error(`missing ${String(ref.identifier)}`);
    });

    const result = await loadListenerPlaylistDetail('listener-a', 'NodeFM', 'p1');
    expect(result.status).toBe('ready');
    if (result.status === 'ready') {
      expect(result.detail.tracks[0].track.trackId).toBe('sub-1');
      expect(result.detail.tracks[0].track.source).toBe('listener-owned');
    }
  });
});
