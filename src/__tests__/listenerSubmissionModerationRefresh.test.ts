/* ============================================================
 * NodeFM Station — Listener Submission Moderation Refresh Tests
 *
 * Regression coverage for the post-Accept/Reject refresh defect and
 * the epoch/scope stale-response guards around submission discovery.
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

import { fetchQdnResourceData, publishResource, searchQdnResources } from '../qortium/qdn';
import { resolveNameWalletAddress } from '../qortium/identity';
import { addTrackToLibrary, getTrackById } from '../features/library/services/libraryService';
import {
  acceptSubmission,
  getSubmissionDiagnostics,
  getSubmissionError,
  getSubmissionIncomplete,
  getSubmissionLoaded,
  getSubmissionLoading,
  getSubmissionReviews,
  loadListenerSubmissions,
  refreshListenerSubmissions,
  rejectSubmission,
  resetListenerSubmissionStore,
} from '../features/listener-submissions/services/submissionStore';
import {
  createListenerTrackSubmission,
  getSubmissionAudioQdnIdentifier,
  getSubmissionQdnIdentifier,
} from '../features/listener-submissions/services/submissionService';
import type {
  ListenerSubmissionReview,
  SubmissionReviewStatus,
} from '../features/listener-submissions/services/submissionStore';
import type { SubmissionModeration } from '../types/domain';

const mockedSearch = vi.mocked(searchQdnResources);
const mockedFetch = vi.mocked(fetchQdnResourceData);
const mockedPublish = vi.mocked(publishResource);
const mockedResolveName = vi.mocked(resolveNameWalletAddress);
const mockedAddTrack = vi.mocked(addTrackToLibrary);
const mockedGetTrack = vi.mocked(getTrackById);

const OWNER_ADDRESS = 'Q-owner';
const STATION_NAME = 'Station';
const LISTENER = 'listener-a';
const LISTENER_ADDRESS = 'Q-listener-a';
const SUBMISSION_PREFIX = 'nodefm-track-submission-';
const MODERATION_PREFIX = 'nodefm-submission-mod-';

function submissionId(index: number): string {
  return `submission-${String(index).padStart(3, '0')}`;
}

function submissionPayload(index: number) {
  return createListenerTrackSubmission({
    submissionId: submissionId(index),
    submitterName: LISTENER,
    submitterAddress: LISTENER_ADDRESS,
    title: `Submission ${index}`,
    audio: {
      service: 'AUDIO',
      name: LISTENER,
      identifier: getSubmissionAudioQdnIdentifier(submissionId(index)),
    },
    durationMs: 90_000,
    submittedAt: new Date(Date.UTC(2026, 7, 20, 12, 0, index)).toISOString(),
  });
}

function searchResult(index: number, name = LISTENER) {
  return {
    service: 'JSON',
    name,
    identifier: getSubmissionQdnIdentifier(submissionId(index)),
    created: index + 1,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return { promise, resolve };
}

function publishResult(identifier: string, name: string, service: string) {
  return {
    accepted: true,
    action: 'PUBLISH_QDN_RESOURCE',
    resource: { identifier, name, service },
  };
}

type SearchResponse = Awaited<ReturnType<typeof searchQdnResources>>;

describe('listener submission moderation refresh regression', () => {
  let moderationResources = new Map<string, SubmissionModeration>();

  function pendingCount(reviews = getSubmissionReviews()): number {
    return reviews.filter((review) => review.status === 'PENDING').length;
  }

  function reviewAt(index: number): ListenerSubmissionReview {
    return getSubmissionReviews()[index];
  }

  function installDiscovery(
    count: number,
    options: {
      names?: Map<number, string>;
      extraResults?: SearchResponse;
    } = {},
  ): SearchResponse {
    const results: SearchResponse = [];

    for (let index = 0; index < count; index += 1) {
      results.push(searchResult(index, options.names?.get(index)));
    }

    if (options.extraResults) {
      results.push(...options.extraResults);
    }

    mockedSearch.mockResolvedValue(results);
    mockedFetch.mockImplementation(async (ref) => {
      if (typeof ref.identifier === 'string' && ref.identifier.startsWith(MODERATION_PREFIX)) {
        const moderation = moderationResources.get(ref.identifier);
        if (moderation) {
          return moderation;
        }

        throw new Error('resource does not exist');
      }

      if (typeof ref.identifier !== 'string' || !ref.identifier.startsWith(SUBMISSION_PREFIX)) {
        throw new Error('unexpected fetch');
      }

      const index = Number(ref.identifier.slice(SUBMISSION_PREFIX.length).split('-')[1]);
      return submissionPayload(index);
    });

    return results;
  }

  beforeEach(() => {
    resetListenerSubmissionStore();
    moderationResources = new Map();
    mockedSearch.mockReset();
    mockedFetch.mockReset();
    mockedPublish.mockReset();
    mockedResolveName.mockReset();
    mockedAddTrack.mockReset();
    mockedGetTrack.mockReset();

    mockedResolveName.mockResolvedValue(LISTENER_ADDRESS);
    mockedAddTrack.mockResolvedValue(undefined as never);
    mockedGetTrack.mockReturnValue(undefined);
    mockedPublish.mockImplementation(async (input) => {
      const identifier = input.identifier ?? 'default';
      const name = input.name;
      const service = input.service;

      if (service === 'JSON' && identifier.startsWith(MODERATION_PREFIX)) {
        const payload = JSON.parse(atob(input.data64 ?? '')) as SubmissionModeration | null;

        if (payload && (payload.decision === 'accepted' || payload.decision === 'rejected')) {
          moderationResources.set(identifier, payload);
        }
      }

      return publishResult(identifier, name, service);
    });
  });

  it('accepts one of many pending submissions and keeps the rest visible after refresh', async () => {
    installDiscovery(37);
    await loadListenerSubmissions(STATION_NAME, OWNER_ADDRESS);

    expect(getSubmissionReviews()).toHaveLength(37);
    expect(pendingCount()).toBe(37);

    const first = reviewAt(0);
    await acceptSubmission(first, STATION_NAME, OWNER_ADDRESS, OWNER_ADDRESS);
    await refreshListenerSubmissions(STATION_NAME, OWNER_ADDRESS);

    expect(getSubmissionReviews()).toHaveLength(37);
    expect(pendingCount()).toBe(36);
    expect(getSubmissionReviews()[0].status).toBe('ACCEPTED');
    expect(
      getSubmissionReviews()
        .slice(1)
        .every((review) => review.status === 'PENDING'),
    ).toBe(true);
  });

  it('supports sequential Accept actions without losing the remaining list', async () => {
    installDiscovery(37);
    await loadListenerSubmissions(STATION_NAME, OWNER_ADDRESS);

    await acceptSubmission(reviewAt(0), STATION_NAME, OWNER_ADDRESS, OWNER_ADDRESS);
    await refreshListenerSubmissions(STATION_NAME, OWNER_ADDRESS);
    expect(pendingCount()).toBe(36);

    await acceptSubmission(reviewAt(1), STATION_NAME, OWNER_ADDRESS, OWNER_ADDRESS);
    await refreshListenerSubmissions(STATION_NAME, OWNER_ADDRESS);
    expect(pendingCount()).toBe(35);

    expect(getSubmissionReviews()).toHaveLength(37);
    expect(
      getSubmissionReviews()
        .slice(2)
        .every((review) => review.status === 'PENDING'),
    ).toBe(true);
  });

  it('supports sequential mixed Accept/Reject actions', async () => {
    installDiscovery(37);
    await loadListenerSubmissions(STATION_NAME, OWNER_ADDRESS);

    await acceptSubmission(reviewAt(0), STATION_NAME, OWNER_ADDRESS, OWNER_ADDRESS);
    await refreshListenerSubmissions(STATION_NAME, OWNER_ADDRESS);

    await acceptSubmission(reviewAt(1), STATION_NAME, OWNER_ADDRESS, OWNER_ADDRESS);
    await refreshListenerSubmissions(STATION_NAME, OWNER_ADDRESS);

    await rejectSubmission(reviewAt(2), STATION_NAME, OWNER_ADDRESS, OWNER_ADDRESS, 'not a fit');
    await refreshListenerSubmissions(STATION_NAME, OWNER_ADDRESS);

    expect(pendingCount()).toBe(34);
    expect(getSubmissionReviews()).toHaveLength(37);
    expect(getSubmissionReviews()[0].status).toBe('ACCEPTED');
    expect(getSubmissionReviews()[1].status).toBe('ACCEPTED');
    expect(getSubmissionReviews()[2].status).toBe('REJECTED');
  });

  it('keeps a failed moderation visible and does not turn it into accepted/rejected state', async () => {
    installDiscovery(37);
    await loadListenerSubmissions(STATION_NAME, OWNER_ADDRESS);
    mockedPublish.mockRejectedValueOnce(new Error('moderation publish failed'));

    const first = reviewAt(0);
    await expect(
      acceptSubmission(first, STATION_NAME, OWNER_ADDRESS, OWNER_ADDRESS),
    ).rejects.toThrow(/moderation publication failed/);

    expect(getSubmissionReviews()).toHaveLength(37);
    expect(pendingCount()).toBe(37);
    expect(getSubmissionReviews()[0].status).toBe('PENDING');
  });

  it('preserves the already-visible list when post-mutation refresh fails', async () => {
    installDiscovery(37);
    await loadListenerSubmissions(STATION_NAME, OWNER_ADDRESS);

    await acceptSubmission(reviewAt(0), STATION_NAME, OWNER_ADDRESS, OWNER_ADDRESS);
    expect(getSubmissionReviews()[0].status).toBe('ACCEPTED');

    mockedSearch.mockRejectedValueOnce(new Error('search temporarily unavailable'));
    await refreshListenerSubmissions(STATION_NAME, OWNER_ADDRESS);

    expect(getSubmissionReviews()).toHaveLength(37);
    expect(getSubmissionReviews()[0].status).toBe('ACCEPTED');
    expect(getSubmissionError()).toBe('search temporarily unavailable');
    expect(getSubmissionLoaded()).toBe(true);
    expect(getSubmissionLoading()).toBe(false);
    expect(getSubmissionIncomplete()).toBe(false);
    expect(getSubmissionDiagnostics()).toEqual([]);
  });

  it('does not let a late stale pre-action refresh overwrite newer moderation state', async () => {
    installDiscovery(37);
    await loadListenerSubmissions(STATION_NAME, OWNER_ADDRESS);

    const staleSearch = deferred<SearchResponse>();
    mockedSearch.mockImplementationOnce(() => staleSearch.promise);
    const staleRefresh = refreshListenerSubmissions(STATION_NAME, OWNER_ADDRESS);

    await acceptSubmission(reviewAt(0), STATION_NAME, OWNER_ADDRESS, OWNER_ADDRESS);

    installDiscovery(37);
    await refreshListenerSubmissions(STATION_NAME, OWNER_ADDRESS);
    expect(getSubmissionReviews()[0].status).toBe('ACCEPTED');

    // Make the late, already-started stale load observe the pre-accept QDN
    // world: all 37 submissions still PENDING. Without an epoch guard it
    // would replace the newer accepted review below.
    mockedFetch.mockImplementation(async (ref) => {
      if (typeof ref.identifier === 'string' && ref.identifier.startsWith(MODERATION_PREFIX)) {
        throw new Error('resource does not exist');
      }

      if (typeof ref.identifier !== 'string' || !ref.identifier.startsWith(SUBMISSION_PREFIX)) {
        throw new Error('unexpected fetch');
      }

      const index = Number(ref.identifier.slice(SUBMISSION_PREFIX.length).split('-')[1]);
      return submissionPayload(index);
    });

    staleSearch.resolve(Array.from({ length: 37 }, (_, index) => searchResult(index)));
    await staleRefresh;

    expect(getSubmissionReviews()[0].status).toBe('ACCEPTED');
    expect(pendingCount()).toBe(36);
    expect(getSubmissionReviews()).toHaveLength(37);
  });

  it('does not let an old account load overwrite a newer account scope', async () => {
    installDiscovery(37);
    await loadListenerSubmissions(STATION_NAME, OWNER_ADDRESS);

    const staleSearch = deferred<SearchResponse>();
    mockedSearch.mockImplementationOnce(() => staleSearch.promise);
    const staleRefresh = refreshListenerSubmissions(STATION_NAME, OWNER_ADDRESS);

    const otherName = 'OtherStation';
    const otherAddress = 'Q-other-owner';
    mockedResolveName.mockResolvedValue('Q-other-listener');
    const otherSearchResults: SearchResponse = [
      {
        service: 'JSON',
        name: 'listener-other',
        identifier: getSubmissionQdnIdentifier('other-submission'),
        created: 1,
      },
    ];
    mockedSearch.mockResolvedValue(otherSearchResults);
    mockedFetch.mockImplementation(async (ref) => {
      if (typeof ref.identifier === 'string' && ref.identifier.startsWith(MODERATION_PREFIX)) {
        throw new Error('resource does not exist');
      }

      if (ref.identifier === getSubmissionQdnIdentifier('other-submission')) {
        return createListenerTrackSubmission({
          submissionId: 'other-submission',
          submitterName: 'listener-other',
          submitterAddress: 'Q-other-listener',
          title: 'Other Submission',
          audio: {
            service: 'AUDIO',
            name: 'listener-other',
            identifier: getSubmissionAudioQdnIdentifier('other-submission'),
          },
          durationMs: 90_000,
          submittedAt: '2026-08-20T11:00:00.000Z',
        });
      }

      throw new Error('unexpected fetch');
    });

    await loadListenerSubmissions(otherName, otherAddress);
    expect(getSubmissionReviews()).toHaveLength(1);
    expect(getSubmissionReviews()[0].submission.title).toBe('Other Submission');

    // Let the late old-station load resolve with the old account's
    // submission set. It must not overwrite the newer account scope.
    mockedResolveName.mockResolvedValue(LISTENER_ADDRESS);
    mockedFetch.mockImplementation(async (ref) => {
      if (typeof ref.identifier === 'string' && ref.identifier.startsWith(MODERATION_PREFIX)) {
        throw new Error('resource does not exist');
      }

      if (typeof ref.identifier !== 'string' || !ref.identifier.startsWith(SUBMISSION_PREFIX)) {
        throw new Error('unexpected fetch');
      }

      const index = Number(ref.identifier.slice(SUBMISSION_PREFIX.length).split('-')[1]);
      return submissionPayload(index);
    });

    staleSearch.resolve(Array.from({ length: 37 }, (_, index) => searchResult(index)));
    await staleRefresh;

    expect(getSubmissionReviews()).toHaveLength(1);
    expect(getSubmissionReviews()[0].submission.title).toBe('Other Submission');
  });

  it('reports an empty list only when QDN truly has no pending submissions', async () => {
    installDiscovery(0);

    await loadListenerSubmissions(STATION_NAME, OWNER_ADDRESS);

    expect(getSubmissionReviews()).toHaveLength(0);
    expect(getSubmissionLoaded()).toBe(true);
    expect(getSubmissionError()).toBeNull();
    expect(getSubmissionIncomplete()).toBe(false);
    expect(getSubmissionDiagnostics()).toEqual([]);
  });

  it('can perform the full 37-item scale sequence without clearing the store', async () => {
    installDiscovery(37);
    await loadListenerSubmissions(STATION_NAME, OWNER_ADDRESS);
    expect(pendingCount()).toBe(37);

    const first = reviewAt(0);
    await acceptSubmission(first, STATION_NAME, OWNER_ADDRESS, OWNER_ADDRESS);
    await refreshListenerSubmissions(STATION_NAME, OWNER_ADDRESS);
    expect(pendingCount()).toBe(36);

    const second = reviewAt(1);
    await acceptSubmission(second, STATION_NAME, OWNER_ADDRESS, OWNER_ADDRESS);
    await refreshListenerSubmissions(STATION_NAME, OWNER_ADDRESS);
    expect(pendingCount()).toBe(35);

    const third = reviewAt(2);
    await rejectSubmission(third, STATION_NAME, OWNER_ADDRESS, OWNER_ADDRESS, 'not a fit');
    await refreshListenerSubmissions(STATION_NAME, OWNER_ADDRESS);
    expect(pendingCount()).toBe(34);

    expect(getSubmissionReviews()).toHaveLength(37);
    const statuses = getSubmissionReviews().map((review) => review.status);
    expect(statuses.filter((status: SubmissionReviewStatus) => status === 'ACCEPTED')).toHaveLength(
      2,
    );
    expect(statuses.filter((status: SubmissionReviewStatus) => status === 'REJECTED')).toHaveLength(
      1,
    );
    expect(statuses.filter((status: SubmissionReviewStatus) => status === 'PENDING')).toHaveLength(
      34,
    );
  });
});
