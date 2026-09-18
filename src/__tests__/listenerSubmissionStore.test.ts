/* ============================================================
 * NodeFM Station — Listener Submission Store Tests
 *
 * Exercise production publication/discovery/moderation services with
 * mocked QDN and identity boundaries.
 * ============================================================ */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../qortium/qdn', () => ({
  ensureQdnResourceReady: vi.fn(),
  fetchQdnResourceData: vi.fn(),
  getQdnResourceUrl: vi.fn(),
  publishMultipleResources: vi.fn(),
  publishResource: vi.fn(),
  qdnJsonPublishFileName: (identifier: string) => `${identifier}.json`,
  searchQdnResources: vi.fn(),
}));

vi.mock('../qortium/identity', () => ({
  resolveNameWalletAddress: vi.fn(),
}));

vi.mock('../features/library/services/libraryService', () => ({
  getTrackById: vi.fn(),
  trackPublishResource: vi.fn(),
  upsertTrackLocally: vi.fn(),
}));

vi.mock('../utils/duration', async () => {
  const actual = await vi.importActual<typeof import('../utils/duration')>('../utils/duration');

  return {
    ...actual,
    resolveAudioDurationFromUrl: vi.fn(),
  };
});

import {
  ensureQdnResourceReady,
  fetchQdnResourceData,
  getQdnResourceUrl,
  publishMultipleResources,
  publishResource,
  searchQdnResources,
} from '../qortium/qdn';
import { resolveNameWalletAddress } from '../qortium/identity';
import {
  getTrackById,
  trackPublishResource,
  upsertTrackLocally,
} from '../features/library/services/libraryService';
import { resolveAudioDurationFromUrl } from '../utils/duration';
import {
  acceptSubmission,
  getSubmissionDiagnostics,
  getSubmissionError,
  getSubmissionIncomplete,
  getSubmissionReviews,
  loadListenerSubmissions,
  publishListenerSubmission,
  rejectSubmission,
  resetListenerSubmissionStore,
  SubmissionModerationWriteError,
} from '../features/listener-submissions/services/submissionStore';
import {
  createListenerTrackSubmission,
  getSubmissionAudioQdnIdentifier,
  getSubmissionModerationQdnIdentifier,
  getSubmissionQdnIdentifier,
} from '../features/listener-submissions/services/submissionService';
import type { SelectPublishSourceResult } from '../qortium/qdn';

const mockedPublish = vi.mocked(publishResource);
const mockedBatchPublish = vi.mocked(publishMultipleResources);
const mockedSearch = vi.mocked(searchQdnResources);
const mockedFetch = vi.mocked(fetchQdnResourceData);
const mockedEnsureReady = vi.mocked(ensureQdnResourceReady);
const mockedGetUrl = vi.mocked(getQdnResourceUrl);
const mockedResolveDuration = vi.mocked(resolveAudioDurationFromUrl);
const mockedResolveName = vi.mocked(resolveNameWalletAddress);
const mockedTrackPublishResource = vi.mocked(trackPublishResource);
const mockedUpsertTrack = vi.mocked(upsertTrackLocally);
const mockedGetTrack = vi.mocked(getTrackById);

const OWNER_ADDRESS = 'Q-owner';
const STATION_NAME = 'Station';
const LISTENER_A = 'listener-a';
const LISTENER_A_ADDRESS = 'Q-listener-a';
const LISTENER_B = 'listener-b';
const LISTENER_B_ADDRESS = 'Q-listener-b';
const SUBMISSION_ID = '11111111-1111-4111-8111-111111111111';

function publishedResult(identifier: string, name: string, service = 'JSON') {
  return {
    accepted: true,
    action: 'PUBLISH_QDN_RESOURCE',
    resource: { identifier, name, service },
  };
}

function submissionPayload(listener: string, address: string, title: string) {
  return JSON.parse(
    JSON.stringify(
      createListenerTrackSubmission({
        submissionId: SUBMISSION_ID,
        submitterName: listener,
        submitterAddress: address,
        title,
        artist: 'Artist',
        audio: {
          service: 'AUDIO',
          name: listener,
          identifier: getSubmissionAudioQdnIdentifier(SUBMISSION_ID),
        },
        durationMs: 90000,
        submittedAt: '2026-08-20T10:00:00.000Z',
      }),
    ),
  );
}

function searchResult(listener: string, identifier: string, created: number) {
  return {
    service: 'JSON',
    name: listener,
    identifier,
    created,
  };
}

describe('publishListenerSubmission', () => {
  beforeEach(() => {
    mockedPublish.mockReset();
    mockedBatchPublish.mockReset();
    mockedEnsureReady.mockReset();
    mockedGetUrl.mockReset();
    mockedResolveDuration.mockReset();
    mockedResolveName.mockReset();
    mockedSearch.mockReset();
    mockedFetch.mockReset();
    mockedEnsureReady.mockResolvedValue(undefined);
    mockedGetUrl.mockResolvedValue('https://node.example/audio');
    mockedResolveDuration.mockResolvedValue(123456);
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

  it('publishes listener-owned audio first and only then submission metadata', async () => {
    mockedPublish.mockImplementation(async () => {
      return publishedResult('nodefm-track-submission-1', 'listener-a');
    });

    const result = await publishListenerSubmission({
      submissionId: SUBMISSION_ID,
      submitterName: LISTENER_A,
      submitterAddress: LISTENER_A_ADDRESS,
      title: 'Listener Song',
      audioSource: {
        canceled: false,
        fileName: 'song.mp3',
        kind: 'file',
        size: 1000,
        sourceToken: 'token-1',
      } as SelectPublishSourceResult & { canceled: false },
    });

    expect(result.status).toBe('published');
    expect(mockedBatchPublish).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          service: 'AUDIO',
          name: LISTENER_A,
          identifier: getSubmissionAudioQdnIdentifier(SUBMISSION_ID),
          sourceToken: 'token-1',
        }),
      ]),
    );
    expect(mockedPublish).toHaveBeenCalledWith(
      expect.objectContaining({ service: 'JSON', name: LISTENER_A }),
    );
  });

  it('publishes an optional cover under the listener name', async () => {
    mockedPublish.mockImplementation(async () => {
      return publishedResult('nodefm-track-submission-1', LISTENER_A);
    });

    const result = await publishListenerSubmission({
      submissionId: SUBMISSION_ID,
      submitterName: LISTENER_A,
      submitterAddress: LISTENER_A_ADDRESS,
      title: 'Covered Song',
      cover: { fileName: 'cover.jpg', bytesBase64: 'aW1hZ2U=', mimeType: 'image/jpeg' },
      audioSource: {
        canceled: false,
        fileName: 'song.mp3',
        kind: 'file',
        size: 1000,
        sourceToken: 'token-1',
      } as SelectPublishSourceResult & { canceled: false },
    });

    expect(result.status).toBe('published');
    expect(mockedBatchPublish).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ service: 'AUDIO', name: LISTENER_A }),
        expect.objectContaining({ service: 'IMAGE', name: LISTENER_A }),
      ]),
    );
    if (result.status === 'published') {
      expect(result.submission.cover).toEqual({
        service: 'IMAGE',
        name: LISTENER_A,
        identifier: getSubmissionAudioQdnIdentifier(SUBMISSION_ID).replace('audio', 'cover'),
      });
    }
  });

  it('returns partial state and never publishes metadata when duration is invalid', async () => {
    mockedResolveDuration.mockResolvedValue(0);

    const result = await publishListenerSubmission({
      submissionId: SUBMISSION_ID,
      submitterName: LISTENER_A,
      submitterAddress: LISTENER_A_ADDRESS,
      title: 'Bad Duration',
      audioSource: {
        canceled: false,
        fileName: 'song.mp3',
        kind: 'file',
        size: 1000,
        sourceToken: 'token-1',
      } as SelectPublishSourceResult & { canceled: false },
    });

    expect(result.status).toBe('partial');
    expect(mockedBatchPublish).toHaveBeenCalledTimes(1);
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it('preserves a retryable submission draft when metadata publication fails', async () => {
    mockedPublish.mockImplementation(async () => {
      throw new Error('metadata rejected');
    });

    const result = await publishListenerSubmission({
      submissionId: SUBMISSION_ID,
      submitterName: LISTENER_A,
      submitterAddress: LISTENER_A_ADDRESS,
      title: 'Retry Me',
      audioSource: {
        canceled: false,
        fileName: 'song.mp3',
        kind: 'file',
        size: 1000,
        sourceToken: 'token-1',
      } as SelectPublishSourceResult & { canceled: false },
    });

    expect(result.status).toBe('partial');
    expect(mockedBatchPublish).toHaveBeenCalledTimes(1);
    expect(mockedPublish).toHaveBeenCalledTimes(1);
    if (result.status === 'partial') {
      expect(result.audio).toBeTruthy();
      expect(result.submissionDraft?.title).toBe('Retry Me');
    }
  });
});

describe('listener submission discovery', () => {
  beforeEach(() => {
    resetListenerSubmissionStore();
    mockedSearch.mockReset();
    mockedFetch.mockReset();
    mockedResolveName.mockReset();
    mockedResolveName.mockImplementation(async (name) => {
      if (name.toLowerCase() === LISTENER_A) return LISTENER_A_ADDRESS;
      if (name.toLowerCase() === LISTENER_B) return LISTENER_B_ADDRESS;
      return null;
    });

    mockedFetch.mockImplementation(async (ref) => {
      if (ref.identifier?.startsWith('nodefm-submission-mod-')) {
        throw new Error('resource does not exist');
      }

      if (ref.name === LISTENER_A) {
        return submissionPayload(LISTENER_A, LISTENER_A_ADDRESS, 'Song A');
      }

      if (ref.name === LISTENER_B) {
        return submissionPayload(LISTENER_B, LISTENER_B_ADDRESS, 'Song B');
      }

      throw new Error('unexpected fetch');
    });
  });

  it('discovers multiple publishers and multiple submissions with mode=ALL', async () => {
    mockedSearch.mockResolvedValue([
      searchResult(LISTENER_A, getSubmissionQdnIdentifier('a-1'), 1),
      searchResult(LISTENER_A, getSubmissionQdnIdentifier('a-2'), 2),
      searchResult(LISTENER_B, getSubmissionQdnIdentifier('b-1'), 3),
      searchResult(LISTENER_B, getSubmissionQdnIdentifier('b-2'), 4),
      searchResult(LISTENER_A, getSubmissionQdnIdentifier('a-2'), 5),
    ]);

    // Use distinct IDs in payloads even though discovery IDs differ; the
    // fetcher below is keyed only by name in this test, so make payloads use
    // the discovered identifiers.
    mockedFetch.mockImplementation(async (ref) => {
      if (ref.identifier?.startsWith('nodefm-submission-mod-')) {
        throw new Error('resource does not exist');
      }
      if (ref.name === LISTENER_A) {
        return createListenerTrackSubmission({
          submissionId: (ref.identifier as string).slice('nodefm-track-submission-'.length),
          submitterName: LISTENER_A,
          submitterAddress: LISTENER_A_ADDRESS,
          title: `Song ${ref.identifier}`,
          audio: {
            service: 'AUDIO',
            name: LISTENER_A,
            identifier: getSubmissionAudioQdnIdentifier(
              (ref.identifier as string).slice('nodefm-track-submission-'.length),
            ),
          },
          durationMs: 90000,
          submittedAt: '2026-08-20T10:00:00.000Z',
        });
      }
      if (ref.name === LISTENER_B) {
        return createListenerTrackSubmission({
          submissionId: (ref.identifier as string).slice('nodefm-track-submission-'.length),
          submitterName: LISTENER_B,
          submitterAddress: LISTENER_B_ADDRESS,
          title: `Song ${ref.identifier}`,
          audio: {
            service: 'AUDIO',
            name: LISTENER_B,
            identifier: getSubmissionAudioQdnIdentifier(
              (ref.identifier as string).slice('nodefm-track-submission-'.length),
            ),
          },
          durationMs: 90000,
          submittedAt: '2026-08-20T10:00:00.000Z',
        });
      }
      throw new Error('unexpected fetch');
    });

    await loadListenerSubmissions(STATION_NAME, OWNER_ADDRESS);

    expect(mockedSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        service: 'JSON',
        query: 'nodefm-track-submission-',
        prefix: true,
        mode: 'ALL',
      }),
    );
    expect(getSubmissionReviews()).toHaveLength(4);
    expect(getSubmissionIncomplete()).toBe(false);
  });

  it('excludes station moderation resources and audio resources from submission discovery', async () => {
    mockedSearch.mockResolvedValue([
      searchResult(LISTENER_A, getSubmissionQdnIdentifier(SUBMISSION_ID), 1),
      {
        service: 'JSON',
        name: STATION_NAME,
        identifier: getSubmissionModerationQdnIdentifier(SUBMISSION_ID),
        created: 2,
      },
      {
        service: 'AUDIO',
        name: LISTENER_A,
        identifier: getSubmissionAudioQdnIdentifier(SUBMISSION_ID),
        created: 3,
      },
    ]);

    await loadListenerSubmissions(STATION_NAME, OWNER_ADDRESS);

    expect(getSubmissionReviews()).toHaveLength(1);
    expect(getSubmissionDiagnostics()).toEqual([]);
    expect(getSubmissionIncomplete()).toBe(false);
  });

  it('rejects forged identity claims without accepting their payloads', async () => {
    mockedSearch.mockResolvedValue([
      searchResult(LISTENER_A, getSubmissionQdnIdentifier(SUBMISSION_ID), 1),
    ]);
    mockedResolveName.mockResolvedValue('Q-mallory');

    await loadListenerSubmissions(STATION_NAME, OWNER_ADDRESS);

    expect(getSubmissionReviews()).toHaveLength(0);
    expect(getSubmissionDiagnostics().some((entry) => entry.code === 'IDENTITY_UNVERIFIED')).toBe(
      true,
    );
  });

  it('keeps malformed submissions out of the valid review list', async () => {
    mockedSearch.mockResolvedValue([
      searchResult(LISTENER_A, getSubmissionQdnIdentifier(SUBMISSION_ID), 1),
      searchResult(LISTENER_B, getSubmissionQdnIdentifier('bad-1'), 2),
    ]);
    mockedFetch.mockImplementation(async (ref) => {
      if (ref.identifier === getSubmissionQdnIdentifier('bad-1')) {
        return { nope: true };
      }
      if (ref.identifier?.startsWith('nodefm-submission-mod-')) {
        throw new Error('resource does not exist');
      }
      return submissionPayload(LISTENER_A, LISTENER_A_ADDRESS, 'Good Song');
    });

    await loadListenerSubmissions(STATION_NAME, OWNER_ADDRESS);

    expect(getSubmissionReviews()).toHaveLength(1);
    expect(getSubmissionDiagnostics().some((entry) => entry.code === 'MALFORMED_RESOURCE')).toBe(
      true,
    );
  });

  it('isolates an unexpected per-resource fetch failure instead of returning an empty list', async () => {
    mockedSearch.mockResolvedValue([
      searchResult(LISTENER_A, getSubmissionQdnIdentifier('good-1'), 1),
      searchResult(LISTENER_A, getSubmissionQdnIdentifier('broken-1'), 2),
    ]);
    mockedFetch.mockImplementation(async (ref) => {
      if (ref.identifier === getSubmissionQdnIdentifier('broken-1')) {
        throw new Error('network exploded');
      }
      if (ref.identifier?.startsWith('nodefm-submission-mod-')) {
        throw new Error('resource does not exist');
      }

      return createListenerTrackSubmission({
        submissionId: (ref.identifier as string).slice('nodefm-track-submission-'.length),
        submitterName: LISTENER_A,
        submitterAddress: LISTENER_A_ADDRESS,
        title: 'Good Song',
        audio: {
          service: 'AUDIO',
          name: LISTENER_A,
          identifier: getSubmissionAudioQdnIdentifier(
            (ref.identifier as string).slice('nodefm-track-submission-'.length),
          ),
        },
        durationMs: 90000,
        submittedAt: '2026-08-20T10:00:00.000Z',
      });
    });

    await loadListenerSubmissions(STATION_NAME, OWNER_ADDRESS);

    expect(getSubmissionReviews()).toHaveLength(1);
    expect(getSubmissionIncomplete()).toBe(true);
    expect(getSubmissionDiagnostics().some((entry) => entry.code === 'RESOURCE_UNAVAILABLE')).toBe(
      true,
    );
  });

  it('propagates search failure instead of returning an empty valid list', async () => {
    mockedSearch.mockRejectedValue(new Error('search failed'));

    await loadListenerSubmissions(STATION_NAME, OWNER_ADDRESS);

    expect(getSubmissionError()).toBe('search failed');
    expect(getSubmissionReviews()).toHaveLength(0);
  });

  it('reuses the already-loaded account-scoped review state for a same-account remount', async () => {
    mockedSearch.mockResolvedValue([
      searchResult(LISTENER_A, getSubmissionQdnIdentifier(SUBMISSION_ID), 1),
    ]);

    await loadListenerSubmissions(STATION_NAME, OWNER_ADDRESS);
    const firstCallCount = mockedSearch.mock.calls.length;

    await loadListenerSubmissions(STATION_NAME, OWNER_ADDRESS);

    expect(mockedSearch.mock.calls.length).toBe(firstCallCount);
    expect(getSubmissionReviews()).toHaveLength(1);
  });

  it('reloads cleanly when the station owner scope changes', async () => {
    mockedSearch.mockResolvedValue([
      searchResult(LISTENER_A, getSubmissionQdnIdentifier(SUBMISSION_ID), 1),
    ]);

    await loadListenerSubmissions(STATION_NAME, OWNER_ADDRESS);
    await loadListenerSubmissions('OtherStation', 'Q-other-owner');

    expect(mockedSearch.mock.calls.length).toBe(2);
    expect(getSubmissionReviews()).toHaveLength(1);
    expect(getSubmissionError()).toBeNull();
  });
});

describe('owner moderation', () => {
  beforeEach(() => {
    resetListenerSubmissionStore();
    mockedSearch.mockReset();
    mockedFetch.mockReset();
    mockedResolveName.mockReset();
    mockedPublish.mockReset();
    mockedBatchPublish.mockReset();
    mockedTrackPublishResource.mockReset();
    mockedUpsertTrack.mockReset();
    mockedGetTrack.mockReset();
    mockedResolveName.mockResolvedValue(LISTENER_A_ADDRESS);
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
    mockedTrackPublishResource.mockImplementation((track, ownerName) => ({
      service: 'JSON',
      name: ownerName,
      identifier: `nodefm-track-${track.trackId}`,
      data64: 'dHJhY2s=',
      title: track.title,
    }));

    mockedSearch.mockResolvedValue([
      searchResult(LISTENER_A, getSubmissionQdnIdentifier(SUBMISSION_ID), 1),
    ]);
    mockedFetch.mockImplementation(async (ref) => {
      if (ref.identifier?.startsWith('nodefm-submission-mod-')) {
        throw new Error('resource does not exist');
      }
      return submissionPayload(LISTENER_A, LISTENER_A_ADDRESS, 'Moderation Song');
    });
  });

  async function loadPending() {
    await loadListenerSubmissions(STATION_NAME, OWNER_ADDRESS);
    return getSubmissionReviews()[0];
  }

  it('allows the owner to accept and creates a normal Station Track with external audio ref', async () => {
    const review = await loadPending();
    const result = await acceptSubmission(review, STATION_NAME, OWNER_ADDRESS, OWNER_ADDRESS);

    expect(result.status).toBe('accepted');
    expect(mockedBatchPublish).toHaveBeenCalledTimes(1);
    expect(mockedBatchPublish.mock.calls[0][0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          service: 'JSON',
          name: STATION_NAME,
          identifier: `nodefm-track-sub-${SUBMISSION_ID}`,
        }),
        expect.objectContaining({
          service: 'JSON',
          name: STATION_NAME,
          identifier: getSubmissionModerationQdnIdentifier(SUBMISSION_ID),
        }),
      ]),
    );
    expect(getSubmissionReviews()[0].status).toBe('ACCEPTED');
  });

  it('rejects non-owner acceptance before touching the bridge', async () => {
    const review = await loadPending();

    await expect(
      acceptSubmission(review, STATION_NAME, 'Q-mallory', OWNER_ADDRESS),
    ).rejects.toThrow(/Only the station owner/);
    expect(mockedBatchPublish).not.toHaveBeenCalled();
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it('allows owner rejection without deleting listener-owned resources', async () => {
    mockedPublish.mockResolvedValue(
      publishedResult(getSubmissionModerationQdnIdentifier(SUBMISSION_ID), STATION_NAME),
    );

    const review = await loadPending();
    await rejectSubmission(review, STATION_NAME, OWNER_ADDRESS, OWNER_ADDRESS, 'not a fit');

    expect(mockedPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        service: 'JSON',
        name: STATION_NAME,
        identifier: getSubmissionModerationQdnIdentifier(SUBMISSION_ID),
      }),
    );
    expect(getSubmissionReviews()[0].status).toBe('REJECTED');
  });

  it('rejects non-owner rejection before publishing', async () => {
    const review = await loadPending();

    await expect(
      rejectSubmission(review, STATION_NAME, 'Q-mallory', OWNER_ADDRESS),
    ).rejects.toThrow(/Only the station owner/);
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it('does not create a duplicate Station Track on repeated Accept', async () => {
    const review = await loadPending();
    const first = await acceptSubmission(review, STATION_NAME, OWNER_ADDRESS, OWNER_ADDRESS);
    mockedGetTrack.mockReturnValue(first.status === 'accepted' ? first.track : undefined);

    const acceptedReview = getSubmissionReviews()[0];
    const second = await acceptSubmission(
      acceptedReview,
      STATION_NAME,
      OWNER_ADDRESS,
      OWNER_ADDRESS,
    );

    expect(second.status).toBe('already-accepted');
    expect(mockedBatchPublish).toHaveBeenCalledTimes(1);
    expect(mockedUpsertTrack).toHaveBeenCalledTimes(1);
  });

  it('failed Track publication does not become accepted', async () => {
    mockedBatchPublish.mockRejectedValue(new Error('track publish failed'));

    const review = await loadPending();
    await expect(
      acceptSubmission(review, STATION_NAME, OWNER_ADDRESS, OWNER_ADDRESS),
    ).rejects.toThrow(/Failed to publish accepted Station Track/);

    expect(getSubmissionReviews()[0].status).toBe('PENDING');
  });

  it('failed moderation write does not become accepted or rejected', async () => {
    mockedBatchPublish.mockResolvedValue({
      accepted: true,
      action: 'PUBLISH_MULTIPLE_QDN_RESOURCES',
      published: [
        {
          result: {},
          resource: {
            identifier: `nodefm-track-sub-${SUBMISSION_ID}`,
            name: STATION_NAME,
            service: 'JSON',
          },
          transactionSignature: 'signature',
        },
      ],
      failures: [
        {
          error: 'moderation publish failed',
          resource: {
            identifier: getSubmissionModerationQdnIdentifier(SUBMISSION_ID),
            name: STATION_NAME,
            service: 'JSON',
          },
        },
      ],
    });

    const review = await loadPending();
    await expect(
      acceptSubmission(review, STATION_NAME, OWNER_ADDRESS, OWNER_ADDRESS),
    ).rejects.toBeInstanceOf(SubmissionModerationWriteError);

    expect(getSubmissionReviews()[0].status).toBe('PENDING');
  });

  it('does not allow rejecting an already-accepted submission through the moderation flow', async () => {
    mockedPublish.mockResolvedValue(
      publishedResult(getSubmissionModerationQdnIdentifier(SUBMISSION_ID), STATION_NAME),
    );

    const review = await loadPending();
    await acceptSubmission(review, STATION_NAME, OWNER_ADDRESS, OWNER_ADDRESS);
    const acceptedReview = getSubmissionReviews()[0];
    const publishCountAfterAccept = mockedPublish.mock.calls.length;

    await expect(
      rejectSubmission(acceptedReview, STATION_NAME, OWNER_ADDRESS, OWNER_ADDRESS),
    ).rejects.toThrow(/cannot be rejected/);
    expect(mockedPublish.mock.calls.length).toBe(publishCountAfterAccept);
  });
});
