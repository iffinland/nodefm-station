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
  publishResource: vi.fn(),
  searchQdnResources: vi.fn(),
}));

vi.mock('../qortium/identity', () => ({
  resolveNameWalletAddress: vi.fn(),
}));

vi.mock('../features/library/services/libraryService', () => ({
  addTrackToLibrary: vi.fn(),
  getTrackById: vi.fn(),
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
  publishResource,
  searchQdnResources,
} from '../qortium/qdn';
import { resolveNameWalletAddress } from '../qortium/identity';
import { addTrackToLibrary, getTrackById } from '../features/library/services/libraryService';
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
const mockedSearch = vi.mocked(searchQdnResources);
const mockedFetch = vi.mocked(fetchQdnResourceData);
const mockedEnsureReady = vi.mocked(ensureQdnResourceReady);
const mockedGetUrl = vi.mocked(getQdnResourceUrl);
const mockedResolveDuration = vi.mocked(resolveAudioDurationFromUrl);
const mockedResolveName = vi.mocked(resolveNameWalletAddress);
const mockedAddTrack = vi.mocked(addTrackToLibrary);
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
    mockedEnsureReady.mockReset();
    mockedGetUrl.mockReset();
    mockedResolveDuration.mockReset();
    mockedResolveName.mockReset();
    mockedSearch.mockReset();
    mockedFetch.mockReset();
    mockedEnsureReady.mockResolvedValue(undefined);
    mockedGetUrl.mockResolvedValue('https://node.example/audio');
    mockedResolveDuration.mockResolvedValue(123456);
  });

  it('publishes listener-owned audio first and only then submission metadata', async () => {
    mockedPublish.mockImplementation(async (input) => {
      if (input.service === 'AUDIO') {
        return publishedResult('nodefm-submission-audio-1', 'listener-a', 'AUDIO');
      }

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
    expect(mockedPublish.mock.calls.map(([call]) => call.service)).toEqual(['AUDIO', 'JSON']);
    expect(mockedPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        service: 'AUDIO',
        name: LISTENER_A,
        identifier: getSubmissionAudioQdnIdentifier(SUBMISSION_ID),
        sourceToken: 'token-1',
      }),
    );
  });

  it('publishes an optional cover under the listener name', async () => {
    mockedPublish.mockImplementation(async (input) => {
      if (input.service === 'AUDIO') {
        return publishedResult('nodefm-submission-audio-1', LISTENER_A, 'AUDIO');
      }
      if (input.service === 'IMAGE') {
        return publishedResult('nodefm-submission-cover-1', LISTENER_A, 'IMAGE');
      }
      return publishedResult('nodefm-track-submission-1', LISTENER_A);
    });

    const result = await publishListenerSubmission({
      submissionId: SUBMISSION_ID,
      submitterName: LISTENER_A,
      submitterAddress: LISTENER_A_ADDRESS,
      title: 'Covered Song',
      cover: { fileName: 'cover.jpg', data64: 'aW1hZ2U=' },
      audioSource: {
        canceled: false,
        fileName: 'song.mp3',
        kind: 'file',
        size: 1000,
        sourceToken: 'token-1',
      } as SelectPublishSourceResult & { canceled: false },
    });

    expect(result.status).toBe('published');
    if (result.status === 'published') {
      expect(result.submission.cover).toEqual({
        service: 'IMAGE',
        name: LISTENER_A,
        identifier: getSubmissionAudioQdnIdentifier(SUBMISSION_ID).replace('audio', 'cover'),
      });
    }
  });

  it('returns partial state and never publishes metadata when duration is invalid', async () => {
    mockedPublish.mockResolvedValue(
      publishedResult(getSubmissionAudioQdnIdentifier(SUBMISSION_ID), LISTENER_A, 'AUDIO'),
    );
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
    expect(mockedPublish).toHaveBeenCalledTimes(1);
    expect(mockedPublish).toHaveBeenCalledWith(expect.objectContaining({ service: 'AUDIO' }));
  });

  it('preserves a retryable submission draft when metadata publication fails', async () => {
    mockedPublish.mockImplementation(async (input) => {
      if (input.service === 'AUDIO') {
        return publishedResult(getSubmissionAudioQdnIdentifier(SUBMISSION_ID), LISTENER_A, 'AUDIO');
      }
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
    mockedAddTrack.mockReset();
    mockedGetTrack.mockReset();
    mockedResolveName.mockResolvedValue(LISTENER_A_ADDRESS);

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
    mockedPublish.mockResolvedValue(
      publishedResult(getSubmissionModerationQdnIdentifier(SUBMISSION_ID), STATION_NAME),
    );

    const review = await loadPending();
    const result = await acceptSubmission(review, STATION_NAME, OWNER_ADDRESS, OWNER_ADDRESS);

    expect(result.status).toBe('accepted');
    expect(mockedAddTrack).toHaveBeenCalledWith(
      expect.objectContaining({
        trackId: `sub-${SUBMISSION_ID}`,
        audio: {
          service: 'AUDIO',
          name: LISTENER_A,
          identifier: getSubmissionAudioQdnIdentifier(SUBMISSION_ID),
        },
        source: 'qdn-existing',
        ownerAddress: OWNER_ADDRESS,
        submissionId: SUBMISSION_ID,
      }),
      STATION_NAME,
    );
    expect(mockedPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        service: 'JSON',
        name: STATION_NAME,
        identifier: getSubmissionModerationQdnIdentifier(SUBMISSION_ID),
      }),
    );
    expect(getSubmissionReviews()[0].status).toBe('ACCEPTED');
  });

  it('rejects non-owner acceptance before touching the bridge', async () => {
    const review = await loadPending();

    await expect(
      acceptSubmission(review, STATION_NAME, 'Q-mallory', OWNER_ADDRESS),
    ).rejects.toThrow(/Only the station owner/);
    expect(mockedAddTrack).not.toHaveBeenCalled();
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
    mockedPublish.mockResolvedValue(
      publishedResult(getSubmissionModerationQdnIdentifier(SUBMISSION_ID), STATION_NAME),
    );

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
    expect(mockedAddTrack).toHaveBeenCalledTimes(1);
    expect(mockedPublish).toHaveBeenCalledTimes(1);
  });

  it('failed Track publication does not become accepted', async () => {
    mockedAddTrack.mockRejectedValue(new Error('track publish failed'));

    const review = await loadPending();
    await expect(
      acceptSubmission(review, STATION_NAME, OWNER_ADDRESS, OWNER_ADDRESS),
    ).rejects.toThrow(/Failed to publish accepted Station Track/);

    expect(mockedPublish).not.toHaveBeenCalled();
    expect(getSubmissionReviews()[0].status).toBe('PENDING');
  });

  it('failed moderation write does not become accepted or rejected', async () => {
    mockedPublish.mockRejectedValue(new Error('moderation publish failed'));

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
