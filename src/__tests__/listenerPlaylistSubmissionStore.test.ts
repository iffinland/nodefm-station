/* ============================================================
 * NodeFM Station — Listener Playlist Submission Store Tests
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
  };
});

vi.mock('../features/playlists/services/playlistStore', () => ({
  addPlaylistToLocalStore: vi.fn(),
  addPlaylistVersionToLocalStore: vi.fn(),
  playlistPublishResource: vi.fn(),
  playlistVersionPublishResource: vi.fn(),
}));

vi.mock('../features/library/services/libraryService', () => ({
  getTrackById: vi.fn(),
}));

import {
  fetchQdnResourceData,
  publishMultipleResources,
  publishResource,
  searchQdnResources,
} from '../qortium/qdn';
import { isConfirmedQdnNotFoundError } from '../qortium/qdnReadError';
import {
  playlistPublishResource,
  playlistVersionPublishResource,
} from '../features/playlists/services/playlistStore';
import { getTrackById } from '../features/library/services/libraryService';
import {
  acceptListenerPlaylistSubmission,
  getListenerPlaylistSubmissionReviews,
  loadListenerPlaylistSubmissions,
  rejectListenerPlaylistSubmission,
  resetListenerPlaylistSubmissionStore,
  submitListenerPlaylist,
  type ListenerPlaylistSubmissionReview,
} from '../features/listener-playlists/services/listenerPlaylistSubmissionStore';
import { getListenerPlaylistSubmissionQdnIdentifier } from '../features/listener-playlists/services/listenerPlaylistSubmissionService';
import {
  createListenerTrackSubmission,
  createSubmissionModeration,
  getSubmissionAudioQdnIdentifier,
  getSubmissionModerationQdnIdentifier,
  getSubmissionQdnIdentifier,
} from '../features/listener-submissions/services/submissionService';

const mockedFetch = vi.mocked(fetchQdnResourceData);
const mockedPublish = vi.mocked(publishResource);
const mockedBatchPublish = vi.mocked(publishMultipleResources);
const mockedSearch = vi.mocked(searchQdnResources);
const mockedNotFound = vi.mocked(isConfirmedQdnNotFoundError);
const mockedPlaylistPublishResource = vi.mocked(playlistPublishResource);
const mockedVersionPublishResource = vi.mocked(playlistVersionPublishResource);
const mockedGetTrack = vi.mocked(getTrackById);

const LISTENER = 'listener-a';
const LISTENER_ADDRESS = 'Q-listener-a';
const STATION = 'NodeFM';
const OWNER = 'Q-owner';

function review(): ListenerPlaylistSubmissionReview {
  return {
    metadata: {
      service: 'JSON',
      publisherName: LISTENER,
      identifier: getListenerPlaylistSubmissionQdnIdentifier('submission-1'),
      created: 1,
    },
    submission: {
      schemaVersion: 1,
      submissionId: 'submission-1',
      listenerName: LISTENER,
      listenerAddress: LISTENER_ADDRESS,
      playlistId: 'p1',
      playlistTitle: 'Forest Night',
      versionId: 'v1',
      versionRef: {
        service: 'JSON',
        name: LISTENER,
        identifier: 'nodefm-lp-ver-v1',
      },
      submittedAt: '2026-08-29T10:00:00.000Z',
    },
    status: 'PENDING',
    moderation: null,
  };
}

describe('listener playlist submission store', () => {
  beforeEach(() => {
    resetListenerPlaylistSubmissionStore();
    mockedFetch.mockReset();
    mockedPublish.mockReset();
    mockedBatchPublish.mockReset();
    mockedSearch.mockReset();
    mockedNotFound.mockReset();
    mockedNotFound.mockImplementation(
      (error) => error instanceof Error && error.message.includes('missing moderation'),
    );
    mockedPlaylistPublishResource.mockReset();
    mockedVersionPublishResource.mockReset();
    mockedGetTrack.mockReset();

    mockedPublish.mockResolvedValue({
      accepted: true,
      action: 'PUBLISH_QDN_RESOURCE',
      resource: { identifier: null, name: LISTENER, service: 'JSON' },
    } as never);
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
    mockedPlaylistPublishResource.mockImplementation((playlist, ownerName) => ({
      service: 'PLAYLIST',
      name: ownerName,
      identifier: `nodefm-playlist-${playlist.playlistId}`,
      data64: 'cGxheWxpc3Q=',
      title: playlist.title,
    }));
    mockedVersionPublishResource.mockImplementation((version, ownerName) => ({
      service: 'JSON',
      name: ownerName,
      identifier: `nodefm-playlist-version-${version.versionId}`,
      data64: 'dmVyc2lvbg==',
      title: `Version ${version.versionNumber}`,
    }));

    mockedGetTrack.mockReturnValue({
      schemaVersion: 1,
      trackId: 't1',
      ownerAddress: OWNER,
      title: 'Track One',
      audio: { service: 'AUDIO', name: STATION },
      durationMs: 1000,
      source: 'qdn-existing',
      createdAt: '2026-08-29T00:00:00.000Z',
      updatedAt: '2026-08-29T00:00:00.000Z',
    });
  });

  it('submits an exact version reference under the listener name', async () => {
    const submission = await submitListenerPlaylist({
      listenerName: LISTENER,
      listenerAddress: LISTENER_ADDRESS,
      playlistId: 'p1',
      playlistTitle: 'Forest Night',
      versionId: 'v1',
    });

    expect(submission.versionId).toBe('v1');
    expect(mockedPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        service: 'JSON',
        name: LISTENER,
        identifier: getListenerPlaylistSubmissionQdnIdentifier(submission.submissionId),
      }),
    );
  });

  it('accept forks the exact listener version into a station-owned playlist', async () => {
    mockedSearch.mockResolvedValue([]);
    await loadListenerPlaylistSubmissions(STATION, OWNER);

    mockedFetch.mockImplementation(async (ref) => {
      if (ref.identifier === 'nodefm-listener-playlist-p1') {
        return {
          playlistId: 'p1',
          ownerAddress: LISTENER_ADDRESS,
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
          createdBy: LISTENER_ADDRESS,
          createdAt: '2026-08-29T00:00:00.000Z',
          tracks: [{ trackId: 't1', durationMs: 1000 }],
          totalDurationMs: 1000,
        };
      }

      throw new Error(`unexpected ${String(ref.identifier)}`);
    });

    const result = await acceptListenerPlaylistSubmission(review(), STATION, OWNER, OWNER);

    expect(result.status).toBe('accepted');
    expect(mockedBatchPublish).toHaveBeenCalledTimes(1);
    expect(mockedBatchPublish.mock.calls[0][0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ service: 'PLAYLIST', name: STATION }),
        expect.objectContaining({ service: 'JSON', name: STATION }),
      ]),
    );
  });

  it('revalidates owner tracks and maps accepted owner tracks to station track IDs', async () => {
    mockedSearch.mockResolvedValue([]);
    await loadListenerPlaylistSubmissions(STATION, OWNER);

    mockedGetTrack.mockImplementation((trackId) => {
      if (trackId === 'sub-sub-1') {
        return {
          schemaVersion: 1,
          trackId: 'sub-sub-1',
          ownerAddress: OWNER,
          title: 'Accepted Owner Track',
          audio: { service: 'AUDIO', name: LISTENER },
          durationMs: 2000,
          source: 'qdn-existing',
          createdAt: '2026-08-29T00:00:00.000Z',
          updatedAt: '2026-08-29T00:00:00.000Z',
        };
      }

      return undefined;
    });

    mockedFetch.mockImplementation(async (ref) => {
      if (ref.identifier === 'nodefm-listener-playlist-p1') {
        return {
          playlistId: 'p1',
          ownerAddress: LISTENER_ADDRESS,
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
          createdBy: LISTENER_ADDRESS,
          createdAt: '2026-08-29T00:00:00.000Z',
          tracks: [
            {
              trackId: 'sub-1',
              durationMs: 2000,
              kind: 'OWNER_TRACK',
              ownerName: LISTENER,
            },
          ],
          totalDurationMs: 2000,
        };
      }

      if (ref.identifier === getSubmissionQdnIdentifier('sub-1')) {
        return createListenerTrackSubmission({
          submissionId: 'sub-1',
          submitterName: LISTENER,
          submitterAddress: LISTENER_ADDRESS,
          title: 'Owner Track',
          audio: {
            service: 'AUDIO',
            name: LISTENER,
            identifier: getSubmissionAudioQdnIdentifier('sub-1'),
          },
          durationMs: 2000,
        });
      }

      if (ref.identifier === getSubmissionModerationQdnIdentifier('sub-1')) {
        return createSubmissionModeration({
          moderationId: 'sub-1',
          submissionId: 'sub-1',
          submissionRef: {
            service: 'JSON',
            name: LISTENER,
            identifier: getSubmissionQdnIdentifier('sub-1'),
          },
          decision: 'accepted',
          acceptedTrackId: 'sub-sub-1',
          moderatorAddress: OWNER,
        });
      }

      throw new Error(`unexpected ${String(ref.identifier)}`);
    });

    const result = await acceptListenerPlaylistSubmission(review(), STATION, OWNER, OWNER);

    expect(result.status).toBe('accepted');
    expect(mockedBatchPublish).toHaveBeenCalledTimes(1);
  });

  it('reject leaves the listener playlist untouched', async () => {
    mockedSearch.mockResolvedValue([]);
    await loadListenerPlaylistSubmissions(STATION, OWNER);

    const result = await rejectListenerPlaylistSubmission(
      review(),
      STATION,
      OWNER,
      OWNER,
      'Not a fit',
    );

    expect(result.decision).toBe('rejected');
    expect(mockedBatchPublish).not.toHaveBeenCalled();
  });

  it('loads submissions and resolves pending moderation', async () => {
    mockedSearch.mockResolvedValue([
      {
        service: 'JSON',
        name: LISTENER,
        identifier: getListenerPlaylistSubmissionQdnIdentifier('submission-1'),
        created: 1,
      },
    ]);
    mockedFetch.mockImplementation(async (ref) => {
      if (ref.identifier === getListenerPlaylistSubmissionQdnIdentifier('submission-1')) {
        return review().submission;
      }
      throw new Error('missing moderation');
    });

    await loadListenerPlaylistSubmissions(STATION, OWNER);
    expect(getListenerPlaylistSubmissionReviews()[0]?.status).toBe('PENDING');
  });
});
