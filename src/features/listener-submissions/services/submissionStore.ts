/* ============================================================
 * NodeFM Station — Listener Track Submission Store
 *
 * QDN-backed publication, discovery, identity validation, and owner
 * moderation for listener track submissions.
 *
 * Listener submissions are immutable listener-owned JSON resources.
 * Owner moderation is a separate station-owned JSON resource under the
 * canonical station publisher name. A listener can never publish a
 * moderation record under the station publisher name, and the store
 * rejects moderation records from any other publisher.
 * ============================================================ */

import type {
  ListenerTrackSubmission,
  QdnResourceRef,
  SubmissionModeration,
  SubmissionModerationDecision,
} from '../../../types/domain';
import {
  ensureQdnResourceReady,
  fetchQdnResourceData,
  getQdnResourceUrl,
  publishResource,
  searchQdnResources,
  type SelectPublishSourceResult,
} from '../../../qortium/qdn';
import { resolveNameWalletAddress } from '../../../qortium/identity';
import { resolveAudioDurationFromUrl } from '../../../utils/duration';
import { addTrackToLibrary, getTrackById } from '../../library/services/libraryService';
import { createTrack } from '../../tracks/services/trackService';
import {
  SUBMISSION_IDENTIFIER_PREFIX,
  SUBMISSION_QDN_SERVICE,
  createListenerTrackSubmission,
  createSubmissionModeration,
  deserializeSubmissionFromQdn,
  deserializeSubmissionModerationFromQdn,
  getAcceptedSubmissionTrackId,
  getSubmissionAudioQdnIdentifier,
  getSubmissionCoverQdnIdentifier,
  getSubmissionModerationQdnIdentifier,
  getSubmissionQdnIdentifier,
  isSubmissionQdnIdentifier,
  normalizeSubmissionName,
  serializeSubmissionForQdn,
  serializeSubmissionModerationForQdn,
  validateSubmissionStructuralIntegrity,
  type SubmissionDiagnostic,
  type SubmissionDiagnosticCode,
} from './submissionService';

type SubmissionListener = () => void;

export type SubmissionReviewStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED';

export type ListenerSubmissionMetadata = {
  service: string;
  publisherName: string;
  identifier: string;
  created: number;
  updated: number | null;
};

export type ListenerSubmissionReview = {
  metadata: ListenerSubmissionMetadata;
  submission: ListenerTrackSubmission;
  status: SubmissionReviewStatus;
  moderation: SubmissionModeration | null;
  moderationError?: string;
};

export type SubmissionPublishInput = {
  submissionId: string;
  submitterName: string;
  submitterAddress: string;
  title: string;
  artist?: string;
  description?: string;
  genres?: string[];
  tags?: string[];
  audioSource: Exclude<SelectPublishSourceResult, { canceled: true }>;
  cover?: {
    fileName: string;
    data64: string;
  };
};

export type SubmissionPublishResult =
  | {
      status: 'published';
      submission: ListenerTrackSubmission;
    }
  | {
      status: 'partial';
      reason: string;
      audio: QdnResourceRef;
      cover?: QdnResourceRef;
      submissionDraft?: ListenerTrackSubmission;
    }
  | {
      status: 'failed';
      reason: string;
    };

export type AcceptSubmissionResult =
  | {
      status: 'accepted';
      track: ReturnType<typeof createTrack>;
      moderation: SubmissionModeration;
    }
  | {
      status: 'already-accepted';
      track: ReturnType<typeof createTrack>;
      moderation: SubmissionModeration;
    };

export class SubmissionModerationWriteError extends Error {
  readonly track?: ReturnType<typeof createTrack>;

  constructor(message: string, track?: ReturnType<typeof createTrack>) {
    super(message);
    this.name = 'SubmissionModerationWriteError';
    this.track = track;
  }
}

let reviews: ListenerSubmissionReview[] = [];
let diagnostics: SubmissionDiagnostic[] = [];
let loaded = false;
let loading = false;
let error: string | null = null;
let incomplete = false;
let scope: string | null = null;
let epoch = 0;
let loadPromise: Promise<void> | null = null;

const listeners = new Set<SubmissionListener>();

function notify() {
  listeners.forEach((listener) => listener());
}

function metadataFromResult(result: {
  name?: string;
  service?: string;
  identifier?: string;
  created?: number;
  updated?: number;
}): ListenerSubmissionMetadata | null {
  if (
    typeof result.name !== 'string' ||
    !result.name.trim() ||
    typeof result.service !== 'string' ||
    !result.service.trim() ||
    typeof result.identifier !== 'string' ||
    !result.identifier.trim() ||
    typeof result.created !== 'number' ||
    !Number.isSafeInteger(result.created)
  ) {
    return null;
  }

  return {
    service: result.service.trim(),
    publisherName: result.name.trim(),
    identifier: result.identifier.trim(),
    created: result.created,
    updated:
      typeof result.updated === 'number' && Number.isSafeInteger(result.updated)
        ? result.updated
        : null,
  };
}

function isMissingResourceError(value: unknown): boolean {
  return (
    value instanceof Error &&
    /does not exist|not found|not published|unavailable|empty payload/i.test(value.message)
  );
}

function diagnostic(
  code: SubmissionDiagnosticCode,
  identifier: string,
  detail: string,
): SubmissionDiagnostic {
  return { code, identifier, detail };
}

function normalizeWalletAddress(value: string): string {
  return value.trim();
}

// ── Subscriptions and accessors ────────────────────────────────────

export function subscribeToSubmissionStore(listener: SubmissionListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSubmissionReviews(): ListenerSubmissionReview[] {
  return reviews.map((review) => ({
    ...review,
    metadata: { ...review.metadata },
    submission: { ...review.submission },
    moderation: review.moderation ? { ...review.moderation } : null,
  }));
}

export function getSubmissionLoaded(): boolean {
  return loaded;
}

export function getSubmissionLoading(): boolean {
  return loading;
}

export function getSubmissionError(): string | null {
  return error;
}

export function getSubmissionIncomplete(): boolean {
  return incomplete;
}

export function getSubmissionDiagnostics(): SubmissionDiagnostic[] {
  return [...diagnostics];
}

// ── Listener publication ───────────────────────────────────────────

/**
 * Publish a listener-owned AUDIO (and optional IMAGE cover) and then the
 * immutable JSON submission proposal. This function never publishes the
 * final submission metadata until a finite, positive duration is resolved.
 *
 * Publication is coordinated at the application layer, not atomic. Partial
 * results preserve the already-published media references so a caller can
 * retry metadata publication without re-selecting or re-publishing media.
 */
export async function publishListenerSubmission(
  input: SubmissionPublishInput,
): Promise<SubmissionPublishResult> {
  if (!input.submitterName.trim()) {
    return {
      status: 'failed',
      reason: 'A registered Qortium name is required to publish a submission.',
    };
  }

  if (!input.submitterAddress.trim()) {
    return {
      status: 'failed',
      reason: 'An authenticated account is required to publish a submission.',
    };
  }

  if (!input.title.trim()) {
    return {
      status: 'failed',
      reason: 'A submission title is required.',
    };
  }

  if (
    input.genres !== undefined &&
    (!Array.isArray(input.genres) || input.genres.some((entry) => !entry.trim()))
  ) {
    return {
      status: 'failed',
      reason: 'Submission genres must be non-empty strings.',
    };
  }

  if (
    input.tags !== undefined &&
    (!Array.isArray(input.tags) || input.tags.some((entry) => !entry.trim()))
  ) {
    return {
      status: 'failed',
      reason: 'Submission tags must be non-empty strings.',
    };
  }

  if (!input.audioSource || input.audioSource.canceled) {
    return {
      status: 'failed',
      reason: 'An audio source is required.',
    };
  }

  const audioIdentifier = getSubmissionAudioQdnIdentifier(input.submissionId);
  const audioRef: QdnResourceRef = {
    service: 'AUDIO',
    name: input.submitterName.trim(),
    identifier: audioIdentifier,
  };

  try {
    const audioResult = await publishResource({
      service: 'AUDIO',
      name: input.submitterName.trim(),
      identifier: audioIdentifier,
      sourceToken: input.audioSource.sourceToken,
      title: input.title.trim(),
      filename: input.audioSource.fileName,
    });

    if (!audioResult.accepted) {
      return {
        status: 'failed',
        reason: 'Audio publication was not accepted.',
      };
    }
  } catch (publishError) {
    return {
      status: 'failed',
      reason: publishError instanceof Error ? publishError.message : 'Audio publication failed.',
    };
  }

  let coverRef: QdnResourceRef | undefined;

  if (input.cover) {
    try {
      const coverIdentifier = getSubmissionCoverQdnIdentifier(input.submissionId);
      const coverResult = await publishResource({
        service: 'IMAGE',
        name: input.submitterName.trim(),
        identifier: coverIdentifier,
        data64: input.cover.data64,
        title: `${input.title.trim()} cover`,
        filename: input.cover.fileName,
      });

      if (coverResult.accepted) {
        coverRef = {
          service: 'IMAGE',
          name: input.submitterName.trim(),
          identifier: coverIdentifier,
        };
      }
    } catch {
      // A cover failure is non-fatal. The already-published audio remains intact.
    }
  }

  let durationMs: number | null = null;
  let durationReason = '';

  try {
    await ensureQdnResourceReady(audioRef);
    const audioUrl = await getQdnResourceUrl(audioRef);
    durationMs = await resolveAudioDurationFromUrl(audioUrl);

    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      durationMs = null;
      durationReason = 'Resolved audio duration is not a positive finite value.';
    }
  } catch (durationError) {
    durationReason =
      durationError instanceof Error ? durationError.message : 'Audio duration resolution failed.';
  }

  if (durationMs === null) {
    return {
      status: 'partial',
      reason: durationReason || 'Audio duration could not be resolved.',
      audio: audioRef,
      cover: coverRef,
    };
  }

  const submissionDraft = createListenerTrackSubmission({
    submissionId: input.submissionId,
    submitterName: input.submitterName.trim(),
    submitterAddress: input.submitterAddress.trim(),
    title: input.title,
    artist: input.artist,
    description: input.description,
    audio: audioRef,
    cover: coverRef,
    durationMs,
    genres: input.genres,
    tags: input.tags,
  });

  try {
    const submissionResult = await publishResource({
      service: SUBMISSION_QDN_SERVICE,
      name: input.submitterName.trim(),
      identifier: getSubmissionQdnIdentifier(input.submissionId),
      data64: btoa(unescape(encodeURIComponent(serializeSubmissionForQdn(submissionDraft)))),
      title: submissionDraft.title,
      description: submissionDraft.description,
      tags: submissionDraft.tags,
    });

    if (!submissionResult.accepted) {
      throw new Error('Submission metadata publication was not accepted.');
    }
  } catch (metadataError) {
    return {
      status: 'partial',
      reason:
        metadataError instanceof Error
          ? metadataError.message
          : 'Submission metadata publication failed.',
      audio: audioRef,
      cover: coverRef,
      submissionDraft,
    };
  }

  return {
    status: 'published',
    submission: submissionDraft,
  };
}

/**
 * Retry only the JSON submission-metadata publication after media already
 * published. This deliberately reuses the canonical media references and
 * never accepts a new source token or file input.
 */
export async function publishSubmissionMetadata(
  submission: ListenerTrackSubmission,
  submitterName: string,
): Promise<{ accepted: true }> {
  if (
    normalizeSubmissionName(submission.submitterName) !== normalizeSubmissionName(submitterName)
  ) {
    throw new Error('Submission publisher does not match the acting account name.');
  }

  const result = await publishResource({
    service: SUBMISSION_QDN_SERVICE,
    name: submission.submitterName,
    identifier: getSubmissionQdnIdentifier(submission.submissionId),
    data64: btoa(unescape(encodeURIComponent(serializeSubmissionForQdn(submission)))),
    title: submission.title,
    description: submission.description,
    tags: submission.tags,
  });

  if (!result.accepted) {
    throw new Error('Submission metadata publication was not accepted.');
  }

  return { accepted: true };
}

// ── Discovery ──────────────────────────────────────────────────────

async function loadReviewRecordsInternal(
  stationPublisherName: string,
  ownerAddress: string,
): Promise<void> {
  incomplete = false;

  const results = await searchQdnResources({
    service: SUBMISSION_QDN_SERVICE,
    query: SUBMISSION_IDENTIFIER_PREFIX,
    prefix: true,
    mode: 'ALL',
    limit: 1000,
    includeMetadata: true,
  });

  const pendingReviews: Array<Omit<ListenerSubmissionReview, 'status' | 'moderation'>> = [];
  const walletByName = new Map<string, string | null>();

  for (const result of results) {
    const metadata = metadataFromResult(result);
    const identifier = typeof result.identifier === 'string' ? result.identifier : '<unknown>';

    if (!metadata) {
      diagnostics.push(
        diagnostic(
          'INVALID_METADATA',
          identifier,
          'Submission discovery result is missing trusted QDN metadata.',
        ),
      );
      incomplete = true;
      continue;
    }

    if (!isSubmissionQdnIdentifier(metadata.identifier)) {
      continue;
    }

    const uniqueKey = `${metadata.publisherName}\u0000${metadata.identifier}`;
    if (
      pendingReviews.some(
        (review) =>
          `${review.metadata.publisherName}\u0000${review.metadata.identifier}` === uniqueKey,
      )
    ) {
      continue;
    }

    let payload: unknown;
    try {
      payload = await fetchQdnResourceData({
        service: SUBMISSION_QDN_SERVICE,
        name: metadata.publisherName,
        identifier: metadata.identifier,
      });
    } catch (fetchError) {
      if (isMissingResourceError(fetchError)) {
        diagnostics.push(
          diagnostic('RESOURCE_UNAVAILABLE', identifier, 'Submission resource is unavailable.'),
        );
        incomplete = true;
      } else {
        diagnostics.push(
          diagnostic(
            'RESOURCE_UNAVAILABLE',
            identifier,
            `Submission resource could not be fetched: ${
              fetchError instanceof Error ? fetchError.message : 'unknown error'
            }`,
          ),
        );
        incomplete = true;
      }

      continue;
    }

    const submission = deserializeSubmissionFromQdn(payload);

    if (!submission) {
      diagnostics.push(
        diagnostic('MALFORMED_RESOURCE', identifier, 'Invalid listener track submission resource.'),
      );
      continue;
    }

    const structural = validateSubmissionStructuralIntegrity(
      submission,
      metadata.publisherName,
      metadata.identifier,
    );

    if (!structural.ok) {
      diagnostics.push(diagnostic(structural.code, identifier, structural.detail));
      continue;
    }

    const normalizedName = normalizeSubmissionName(submission.submitterName);
    if (!walletByName.has(normalizedName)) {
      try {
        walletByName.set(normalizedName, await resolveNameWalletAddress(submission.submitterName));
      } catch {
        walletByName.set(normalizedName, null);
      }
    }

    const resolvedAddress = walletByName.get(normalizedName);
    if (
      typeof resolvedAddress !== 'string' ||
      normalizeWalletAddress(resolvedAddress) !==
        normalizeWalletAddress(submission.submitterAddress)
    ) {
      diagnostics.push(
        diagnostic(
          'IDENTITY_UNVERIFIED',
          identifier,
          'Submission submitterAddress does not match the verified Qortium name owner.',
        ),
      );
      continue;
    }

    pendingReviews.push({ metadata, submission });
  }

  const nextReviews: ListenerSubmissionReview[] = [];

  for (const pending of pendingReviews) {
    const submission = pending.submission;
    const moderationIdentifier = getSubmissionModerationQdnIdentifier(submission.submissionId);
    let moderation: SubmissionModeration | null = null;
    let status: SubmissionReviewStatus = 'PENDING';
    let moderationError: string | undefined;

    try {
      const moderationPayload = await fetchQdnResourceData({
        service: SUBMISSION_QDN_SERVICE,
        name: stationPublisherName,
        identifier: moderationIdentifier,
      });
      const parsedModeration = deserializeSubmissionModerationFromQdn(moderationPayload);

      if (!parsedModeration) {
        throw new Error('Invalid station moderation resource.');
      }

      const expectedSubmissionRef: QdnResourceRef = {
        service: SUBMISSION_QDN_SERVICE,
        name: pending.metadata.publisherName,
        identifier: pending.metadata.identifier,
      };

      if (
        parsedModeration.moderationId !== submission.submissionId ||
        parsedModeration.submissionId !== submission.submissionId ||
        parsedModeration.submissionRef.service !== expectedSubmissionRef.service ||
        parsedModeration.submissionRef.name !== expectedSubmissionRef.name ||
        parsedModeration.submissionRef.identifier !== expectedSubmissionRef.identifier ||
        parsedModeration.moderatorAddress !== ownerAddress
      ) {
        throw new Error('Station moderation resource does not match this submission.');
      }

      if (
        parsedModeration.decision === 'accepted' &&
        parsedModeration.acceptedTrackId !== getAcceptedSubmissionTrackId(submission.submissionId)
      ) {
        throw new Error('Accepted moderation resource has an invalid acceptedTrackId.');
      }

      moderation = parsedModeration;
      status = parsedModeration.decision === 'accepted' ? 'ACCEPTED' : 'REJECTED';
    } catch (moderationFetchError) {
      if (isMissingResourceError(moderationFetchError)) {
        // No moderation resource yet is the normal PENDING state.
        status = 'PENDING';
      } else {
        moderationError =
          moderationFetchError instanceof Error
            ? moderationFetchError.message
            : 'Moderation state could not be resolved.';
        diagnostics.push(diagnostic('MODERATION_MISMATCH', moderationIdentifier, moderationError));
        incomplete = true;
      }
    }

    nextReviews.push({
      metadata: pending.metadata,
      submission,
      status,
      moderation,
      moderationError,
    });
  }

  nextReviews.sort(
    (left, right) =>
      Date.parse(right.submission.submittedAt) - Date.parse(left.submission.submittedAt),
  );

  reviews = nextReviews;
}

export async function loadListenerSubmissions(
  stationPublisherName: string,
  ownerAddress: string,
  force = false,
): Promise<void> {
  const nextScope = `${stationPublisherName.trim()}\u0000${ownerAddress.trim()}`;

  if (loaded && !force && scope === nextScope) {
    return;
  }

  if (loading && !force && scope === nextScope) {
    if (loadPromise) {
      return loadPromise;
    }
    return;
  }

  if (force && loadPromise) {
    epoch += 1;
    loaded = false;
    loading = false;
    reviews = [];
    diagnostics = [];
    error = null;
    incomplete = false;
    loadPromise = null;
  }

  const currentEpoch = epoch;
  scope = nextScope;
  loading = true;
  error = null;
  reviews = [];
  diagnostics = [];
  incomplete = false;
  notify();

  if (!stationPublisherName.trim() || !ownerAddress.trim()) {
    loaded = true;
    loading = false;
    notify();
    return;
  }

  loadPromise = loadReviewRecordsInternal(stationPublisherName.trim(), ownerAddress.trim())
    .then(() => {
      if (currentEpoch === epoch) {
        loaded = true;
      }
    })
    .catch((loadError) => {
      if (currentEpoch === epoch) {
        error =
          loadError instanceof Error ? loadError.message : 'Failed to load listener submissions.';
      }
    })
    .finally(() => {
      if (currentEpoch === epoch) {
        loading = false;
        loadPromise = null;
        notify();
      }
    });

  return loadPromise;
}

export async function refreshListenerSubmissions(
  stationPublisherName: string,
  ownerAddress: string,
): Promise<void> {
  await loadListenerSubmissions(stationPublisherName, ownerAddress, true);
}

// ── Owner moderation ───────────────────────────────────────────────

function assertOwner(actorAddress: string | null, ownerAddress: string): void {
  if (!actorAddress || !ownerAddress || actorAddress !== ownerAddress) {
    throw new Error('Only the station owner can moderate listener submissions.');
  }
}

function publishModeration(
  moderation: SubmissionModeration,
  stationPublisherName: string,
): Promise<Awaited<ReturnType<typeof publishResource>>> {
  return publishResource({
    service: SUBMISSION_QDN_SERVICE,
    name: stationPublisherName.trim(),
    identifier: getSubmissionModerationQdnIdentifier(moderation.submissionId),
    data64: btoa(unescape(encodeURIComponent(serializeSubmissionModerationForQdn(moderation)))),
    title: `Listener submission ${moderation.decision}`,
  });
}

export async function acceptSubmission(
  review: ListenerSubmissionReview,
  stationPublisherName: string,
  actorAddress: string | null,
  ownerAddress: string,
): Promise<AcceptSubmissionResult> {
  assertOwner(actorAddress, ownerAddress);

  const submission = review.submission;
  const trackId = getAcceptedSubmissionTrackId(submission.submissionId);

  if (
    review.status === 'ACCEPTED' &&
    review.moderation &&
    review.moderation.acceptedTrackId === trackId
  ) {
    const existingTrack = getTrackById(trackId);
    if (!existingTrack) {
      throw new Error('Accepted submission track is missing from the loaded station library.');
    }

    return {
      status: 'already-accepted',
      track: existingTrack,
      moderation: review.moderation,
    };
  }

  const submissionRef: QdnResourceRef = {
    service: SUBMISSION_QDN_SERVICE,
    name: review.metadata.publisherName,
    identifier: review.metadata.identifier,
  };

  const track = createTrack({
    trackId,
    title: submission.title,
    artist: submission.artist,
    description: submission.description,
    audio: submission.audio,
    cover: submission.cover,
    durationMs: submission.durationMs,
    genres: submission.genres,
    tags: submission.tags,
    source: 'qdn-existing',
    ownerAddress,
    submissionId: submission.submissionId,
    submissionRef,
  });

  try {
    if (!getTrackById(track.trackId)) {
      await addTrackToLibrary(track, stationPublisherName.trim());
    }
  } catch (trackError) {
    throw new Error(
      `Failed to publish accepted Station Track: ${
        trackError instanceof Error ? trackError.message : 'Unknown error'
      }`,
    );
  }

  const moderation = createSubmissionModeration({
    moderationId: submission.submissionId,
    submissionId: submission.submissionId,
    submissionRef,
    decision: 'accepted',
    acceptedTrackId: trackId,
    moderatorAddress: ownerAddress,
  });

  try {
    await publishModeration(moderation, stationPublisherName);
  } catch (moderationError) {
    throw new SubmissionModerationWriteError(
      `Station Track was published, but moderation publication failed: ${
        moderationError instanceof Error ? moderationError.message : 'Unknown error'
      }`,
      track,
    );
  }

  reviews = reviews.map((entry) =>
    entry.metadata.identifier === review.metadata.identifier &&
    entry.metadata.publisherName === review.metadata.publisherName
      ? { ...entry, status: 'ACCEPTED', moderation, moderationError: undefined }
      : entry,
  );
  notify();

  return { status: 'accepted', track, moderation };
}

export async function rejectSubmission(
  review: ListenerSubmissionReview,
  stationPublisherName: string,
  actorAddress: string | null,
  ownerAddress: string,
  reason?: string,
): Promise<SubmissionModeration> {
  assertOwner(actorAddress, ownerAddress);

  if (review.status === 'ACCEPTED') {
    throw new Error(
      'Accepted submissions cannot be rejected without first removing the Station Track.',
    );
  }

  const submission = review.submission;
  const moderation = createSubmissionModeration({
    moderationId: submission.submissionId,
    submissionId: submission.submissionId,
    submissionRef: {
      service: SUBMISSION_QDN_SERVICE,
      name: review.metadata.publisherName,
      identifier: review.metadata.identifier,
    },
    decision: 'rejected' satisfies SubmissionModerationDecision,
    reason,
    moderatorAddress: ownerAddress,
  });

  await publishModeration(moderation, stationPublisherName);

  reviews = reviews.map((entry) =>
    entry.metadata.identifier === review.metadata.identifier &&
    entry.metadata.publisherName === review.metadata.publisherName
      ? { ...entry, status: 'REJECTED', moderation, moderationError: undefined }
      : entry,
  );
  notify();

  return moderation;
}

export function resetListenerSubmissionStore(): void {
  epoch += 1;
  reviews = [];
  diagnostics = [];
  loaded = false;
  loading = false;
  error = null;
  incomplete = false;
  scope = null;
  loadPromise = null;
  notify();
}
