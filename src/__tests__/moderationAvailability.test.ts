/* ============================================================
 * NodeFM Station — Moderation Availability Tests
 *
 * Confirmed moderation absence is PENDING. Unavailable/transient
 * moderation is unresolved and cannot be overwritten by an owner
 * action as if no prior decision existed.
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
import {
  acceptSubmission,
  getSubmissionDiagnostics,
  getSubmissionIncomplete,
  getSubmissionReviews,
  loadListenerSubmissions,
  rejectSubmission,
  resetListenerSubmissionStore,
} from '../features/listener-submissions/services/submissionStore';
import {
  createListenerTrackSubmission,
  createSubmissionModeration,
  getSubmissionAudioQdnIdentifier,
  getSubmissionModerationQdnIdentifier,
  getSubmissionQdnIdentifier,
} from '../features/listener-submissions/services/submissionService';
import type { SubmissionModeration } from '../types/domain';

const mockedSearch = vi.mocked(searchQdnResources);
const mockedFetch = vi.mocked(fetchQdnResourceData);
const mockedPublish = vi.mocked(publishResource);
const mockedResolveName = vi.mocked(resolveNameWalletAddress);

const OWNER_ADDRESS = 'Q-owner';
const STATION_NAME = 'Station';
const LISTENER = 'listener-a';
const LISTENER_ADDRESS = 'Q-listener-a';
const SUBMISSION_ID = '11111111-1111-4111-8111-111111111111';

function submissionPayload() {
  return createListenerTrackSubmission({
    submissionId: SUBMISSION_ID,
    submitterName: LISTENER,
    submitterAddress: LISTENER_ADDRESS,
    title: 'Moderation Song',
    audio: {
      service: 'AUDIO',
      name: LISTENER,
      identifier: getSubmissionAudioQdnIdentifier(SUBMISSION_ID),
    },
    durationMs: 90_000,
    submittedAt: '2026-08-20T10:00:00.000Z',
  });
}

function moderationPayload(decision: 'accepted' | 'rejected'): SubmissionModeration {
  return createSubmissionModeration({
    moderationId: SUBMISSION_ID,
    submissionId: SUBMISSION_ID,
    submissionRef: {
      service: 'JSON',
      name: LISTENER,
      identifier: getSubmissionQdnIdentifier(SUBMISSION_ID),
    },
    decision,
    acceptedTrackId: decision === 'accepted' ? `sub-${SUBMISSION_ID}` : undefined,
    moderatorAddress: OWNER_ADDRESS,
  });
}

async function loadSingleSubmission(moderationFetch: () => Promise<unknown> | never) {
  mockedSearch.mockResolvedValue([
    {
      service: 'JSON',
      name: LISTENER,
      identifier: getSubmissionQdnIdentifier(SUBMISSION_ID),
      created: 1,
    },
  ]);
  mockedFetch.mockImplementation(async (ref) => {
    if (ref.identifier === getSubmissionModerationQdnIdentifier(SUBMISSION_ID)) {
      return moderationFetch();
    }

    return submissionPayload();
  });

  await loadListenerSubmissions(STATION_NAME, OWNER_ADDRESS);
}

describe('moderation availability classification', () => {
  beforeEach(() => {
    resetListenerSubmissionStore();
    mockedSearch.mockReset();
    mockedFetch.mockReset();
    mockedPublish.mockReset();
    mockedResolveName.mockReset();
    mockedResolveName.mockResolvedValue(LISTENER_ADDRESS);
  });

  it('treats confirmed moderation absence as PENDING', async () => {
    await loadSingleSubmission(() => {
      throw new Error('resource does not exist');
    });

    const review = getSubmissionReviews()[0];
    expect(review.status).toBe('PENDING');
    expect(review.moderation).toBeNull();
    expect(getSubmissionIncomplete()).toBe(false);
  });

  it('normalizes Core 1401 missing PUT transaction to PENDING', async () => {
    const moderationIdentifier = getSubmissionModerationQdnIdentifier(SUBMISSION_ID);

    await loadSingleSubmission(() => {
      throw new Error(
        `QDN error 1401: Couldn't find PUT transaction for name ${STATION_NAME}, service JSON and identifier ${moderationIdentifier}`,
      );
    });

    const review = getSubmissionReviews()[0];
    expect(review.status).toBe('PENDING');
    expect(review.moderation).toBeNull();
    expect(getSubmissionIncomplete()).toBe(false);
  });

  it('normalizes stringified Core 1401 error bodies to PENDING', async () => {
    const moderationIdentifier = getSubmissionModerationQdnIdentifier(SUBMISSION_ID);

    await loadSingleSubmission(() => {
      throw new Error(
        JSON.stringify({
          error: 1401,
          message: `Couldn't find PUT transaction for name ${STATION_NAME}, service JSON and identifier ${moderationIdentifier}`,
        }),
      );
    });

    expect(getSubmissionReviews()[0].status).toBe('PENDING');
    expect(getSubmissionIncomplete()).toBe(false);
  });

  it('reconstructs an ACCEPTED moderation resource as ACCEPTED', async () => {
    await loadSingleSubmission(async () => moderationPayload('accepted'));

    const review = getSubmissionReviews()[0];
    expect(review.status).toBe('ACCEPTED');
    expect(review.moderation?.decision).toBe('accepted');
  });

  it('reconstructs a REJECTED moderation resource as REJECTED', async () => {
    await loadSingleSubmission(async () => moderationPayload('rejected'));

    const review = getSubmissionReviews()[0];
    expect(review.status).toBe('REJECTED');
    expect(review.moderation?.decision).toBe('rejected');
  });

  it('keeps a malformed moderation resource unresolved, not PENDING', async () => {
    await loadSingleSubmission(async () => ({
      schemaVersion: 1,
      moderationId: 'not-valid',
    }));

    const review = getSubmissionReviews()[0];
    expect(review.status).toBe('UNRESOLVED');
    expect(review.moderationError).toContain('Invalid station moderation resource');
    expect(getSubmissionIncomplete()).toBe(true);
    expect(getSubmissionDiagnostics().some((item) => item.code === 'MODERATION_UNAVAILABLE')).toBe(
      true,
    );
  });

  it('keeps unavailable moderation unresolved and incomplete, not PENDING', async () => {
    await loadSingleSubmission(() => {
      throw new Error('temporarily unavailable');
    });

    const review = getSubmissionReviews()[0];
    expect(review.status).toBe('UNRESOLVED');
    expect(review.moderationError).toContain('temporarily unavailable');
    expect(getSubmissionIncomplete()).toBe(true);
    expect(getSubmissionDiagnostics().some((item) => item.code === 'MODERATION_UNAVAILABLE')).toBe(
      true,
    );
  });

  it('keeps a timeout/transient moderation read unresolved and incomplete', async () => {
    await loadSingleSubmission(() => {
      throw new Error('request timed out');
    });

    const review = getSubmissionReviews()[0];
    expect(review.status).toBe('UNRESOLVED');
    expect(getSubmissionIncomplete()).toBe(true);
  });

  it('prevents owner accept/reject from overwriting unresolved moderation state', async () => {
    await loadSingleSubmission(() => {
      throw new Error('temporarily unavailable');
    });

    const review = getSubmissionReviews()[0];
    await expect(
      acceptSubmission(review, STATION_NAME, OWNER_ADDRESS, OWNER_ADDRESS),
    ).rejects.toThrow(/Moderation state could not be resolved/);
    await expect(
      rejectSubmission(review, STATION_NAME, OWNER_ADDRESS, OWNER_ADDRESS),
    ).rejects.toThrow(/Moderation state could not be resolved/);
    expect(mockedPublish).not.toHaveBeenCalled();
  });
});
