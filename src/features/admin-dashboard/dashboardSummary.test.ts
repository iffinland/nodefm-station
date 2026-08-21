import { describe, expect, it } from 'vitest';
import {
  getPendingSubmissionCount,
  getPublishedPlaylistCount,
  resolveDashboardCount,
} from './dashboardSummary';
import type { Playlist } from '../../types/domain';
import type { ListenerSubmissionReview } from '../listener-submissions/services/submissionStore';

function playlist(overrides: Partial<Playlist> = {}): Playlist {
  return {
    schemaVersion: 1,
    playlistId: 'playlist-1',
    ownerAddress: 'owner',
    title: 'Playlist',
    visibility: 'private',
    latestVersionId: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function review(status: ListenerSubmissionReview['status']): ListenerSubmissionReview {
  return {
    metadata: {
      service: 'JSON',
      publisherName: 'Listener',
      identifier: `nodefm-track-submission-${status}`,
      created: 1,
      updated: null,
    },
    submission: {
      schemaVersion: 1,
      submissionId: status,
      submitterName: 'Listener',
      submitterAddress: 'Q-listener',
      title: 'Submission',
      audio: { service: 'AUDIO', name: 'Listener', identifier: 'audio' },
      durationMs: 1000,
      submittedAt: '2026-01-01T00:00:00.000Z',
    },
    status,
    moderation: null,
  };
}

describe('dashboard count resolution', () => {
  it('returns a real loaded count', () => {
    expect(
      resolveDashboardCount(
        { loaded: true, loading: false, error: null, incomplete: false, count: 4 },
        'Tracks',
      ),
    ).toEqual({ status: 'ready', value: 4, hint: 'Tracks' });
  });

  it('preserves a real partial count instead of showing a placeholder dash', () => {
    expect(
      resolveDashboardCount(
        { loaded: true, loading: false, error: null, incomplete: true, count: 2 },
        'Tracks',
      ),
    ).toEqual({ status: 'incomplete', value: 2, hint: 'Partial count' });
  });

  it('reports loading and error states without inventing counts', () => {
    expect(
      resolveDashboardCount(
        { loaded: false, loading: true, error: null, incomplete: false, count: 0 },
        'Tracks',
      ),
    ).toEqual({ status: 'loading', value: null, hint: 'Loading…' });

    expect(
      resolveDashboardCount(
        { loaded: false, loading: false, error: 'boom', incomplete: false, count: 0 },
        'Tracks',
      ),
    ).toEqual({ status: 'error', value: null, hint: 'Unable to load' });
  });
});

describe('dashboard summary selectors', () => {
  it('counts logical playlists with a published version, not immutable versions', () => {
    expect(
      getPublishedPlaylistCount([
        playlist({ playlistId: 'a', latestVersionId: 'version-a' }),
        playlist({ playlistId: 'b', latestVersionId: '' }),
        playlist({ playlistId: 'c', latestVersionId: 'version-c' }),
      ]),
    ).toBe(2);
  });

  it('counts only PENDING listener submissions', () => {
    expect(
      getPendingSubmissionCount([
        review('PENDING'),
        review('ACCEPTED'),
        review('PENDING'),
        review('REJECTED'),
        review('UNRESOLVED'),
      ]),
    ).toBe(2);
  });
});
