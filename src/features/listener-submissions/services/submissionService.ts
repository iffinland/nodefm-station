/* ============================================================
 * NodeFM Station — Listener Track Submission Domain Service
 *
 * Pure validation, serialization, and QDN identity helpers for
 * listener-owned submission proposals and station-owned moderation
 * records.
 *
 * A ListenerTrackSubmission is immutable source material. The station
 * owner's moderation decision is published as a separate resource
 * under the canonical station publisher name.
 * ============================================================ */

import type {
  ListenerTrackSubmission,
  QdnResourceRef,
  SubmissionModeration,
  SubmissionModerationDecision,
} from '../../../types/domain';
import { isRecord } from '../../../utils/record';
import { isValidDurationMs } from '../../../utils/duration';
import { isNonEmptyTrimmedString } from '../../../utils/validation';

export const SUBMISSION_QDN_SERVICE = 'JSON';
export const SUBMISSION_IDENTIFIER_PREFIX = 'nodefm-track-submission-';
export const SUBMISSION_AUDIO_IDENTIFIER_PREFIX = 'nodefm-submission-audio-';
export const SUBMISSION_COVER_IDENTIFIER_PREFIX = 'nodefm-submission-cover-';
export const SUBMISSION_MODERATION_IDENTIFIER_PREFIX = 'nodefm-submission-mod-';

const MAX_IDENTIFIER_LENGTH = 64;

export type SubmissionDiagnosticCode =
  | 'INVALID_METADATA'
  | 'MALFORMED_RESOURCE'
  | 'IDENTITY_UNVERIFIED'
  | 'IDENTIFIER_MISMATCH'
  | 'AUDIO_MISMATCH'
  | 'COVER_MISMATCH'
  | 'RESOURCE_UNAVAILABLE'
  | 'RESOURCE_NOT_FOUND'
  | 'MODERATION_UNAVAILABLE'
  | 'MODERATION_MISMATCH';

export type SubmissionDiagnostic = {
  code: SubmissionDiagnosticCode;
  identifier: string;
  detail: string;
};

export type SubmissionIdentityValidation =
  { ok: true } | { ok: false; code: SubmissionDiagnosticCode; detail: string };

export function normalizeSubmissionName(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidQdnResourceRef(value: unknown): value is QdnResourceRef {
  return (
    isRecord(value) && isNonEmptyTrimmedString(value.service) && isNonEmptyTrimmedString(value.name)
  );
}

export function isValidUtcTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim() !== '' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value.trim()) &&
    Number.isFinite(Date.parse(value))
  );
}

function assertIdentifierLength(identifier: string): void {
  if (identifier.length > MAX_IDENTIFIER_LENGTH) {
    throw new Error(`QDN identifier exceeds ${MAX_IDENTIFIER_LENGTH} bytes.`);
  }
}

export function getSubmissionQdnIdentifier(submissionId: string): string {
  if (!isNonEmptyTrimmedString(submissionId)) {
    throw new Error('Submission ID is required to build a QDN identifier.');
  }

  const identifier = `${SUBMISSION_IDENTIFIER_PREFIX}${submissionId.trim()}`;
  assertIdentifierLength(identifier);
  return identifier;
}

export function getSubmissionAudioQdnIdentifier(submissionId: string): string {
  if (!isNonEmptyTrimmedString(submissionId)) {
    throw new Error('Submission ID is required to build an audio QDN identifier.');
  }

  const identifier = `${SUBMISSION_AUDIO_IDENTIFIER_PREFIX}${submissionId.trim()}`;
  assertIdentifierLength(identifier);
  return identifier;
}

export function getSubmissionCoverQdnIdentifier(submissionId: string): string {
  if (!isNonEmptyTrimmedString(submissionId)) {
    throw new Error('Submission ID is required to build a cover QDN identifier.');
  }

  const identifier = `${SUBMISSION_COVER_IDENTIFIER_PREFIX}${submissionId.trim()}`;
  assertIdentifierLength(identifier);
  return identifier;
}

export function getSubmissionModerationQdnIdentifier(submissionId: string): string {
  if (!isNonEmptyTrimmedString(submissionId)) {
    throw new Error('Submission ID is required to build a moderation QDN identifier.');
  }

  const identifier = `${SUBMISSION_MODERATION_IDENTIFIER_PREFIX}${submissionId.trim()}`;
  assertIdentifierLength(identifier);
  return identifier;
}

/**
 * Stable track ID for the Station Track created when the owner accepts a
 * submission. Deriving it from the submission ID makes repeated Accept
 * idempotent even if the moderation write is interrupted.
 */
export function getAcceptedSubmissionTrackId(submissionId: string): string {
  if (!isNonEmptyTrimmedString(submissionId)) {
    throw new Error('Submission ID is required to build an accepted track ID.');
  }

  return `sub-${submissionId.trim()}`;
}

export function isSubmissionQdnIdentifier(value: string): boolean {
  return value.startsWith(SUBMISSION_IDENTIFIER_PREFIX);
}

export function isSubmissionModerationQdnIdentifier(value: string): boolean {
  return value.startsWith(SUBMISSION_MODERATION_IDENTIFIER_PREFIX);
}

export type CreateListenerTrackSubmissionInput = {
  submissionId: string;
  submitterName: string;
  submitterAddress: string;
  title: string;
  artist?: string;
  description?: string;
  audio: QdnResourceRef;
  cover?: QdnResourceRef;
  durationMs: number;
  genres?: string[];
  tags?: string[];
  submittedAt?: string;
};

export function createListenerTrackSubmission(
  input: CreateListenerTrackSubmissionInput,
): ListenerTrackSubmission {
  if (!isNonEmptyTrimmedString(input.submissionId)) {
    throw new Error('Submission ID must be a non-empty string.');
  }

  if (!isNonEmptyTrimmedString(input.submitterName)) {
    throw new Error('Submitter name is required.');
  }

  if (!isNonEmptyTrimmedString(input.submitterAddress)) {
    throw new Error('Submitter address is required.');
  }

  if (!isNonEmptyTrimmedString(input.title)) {
    throw new Error('Submission title must be a non-empty string.');
  }

  if (!isValidQdnResourceRef(input.audio)) {
    throw new Error('Submission audio must be a valid QDN resource reference.');
  }

  if (input.cover !== undefined && !isValidQdnResourceRef(input.cover)) {
    throw new Error('Submission cover must be a valid QDN resource reference.');
  }

  if (!isValidDurationMs(input.durationMs)) {
    throw new Error('A valid positive integer durationMs is required for a submission.');
  }

  if (
    input.genres !== undefined &&
    (!Array.isArray(input.genres) || input.genres.some((entry) => !isNonEmptyTrimmedString(entry)))
  ) {
    throw new Error('Submission genres must be an array of non-empty strings.');
  }

  if (
    input.tags !== undefined &&
    (!Array.isArray(input.tags) || input.tags.some((entry) => !isNonEmptyTrimmedString(entry)))
  ) {
    throw new Error('Submission tags must be an array of non-empty strings.');
  }

  const submittedAt = input.submittedAt ?? new Date().toISOString();

  if (!isValidUtcTimestamp(submittedAt)) {
    throw new Error('Submission submittedAt must be a valid UTC timestamp.');
  }

  return {
    schemaVersion: 1,
    submissionId: input.submissionId.trim(),
    submitterName: input.submitterName.trim(),
    submitterAddress: input.submitterAddress.trim(),
    title: input.title.trim(),
    artist: input.artist?.trim(),
    description: input.description,
    audio: {
      service: input.audio.service.toUpperCase(),
      name: input.audio.name.trim(),
      identifier: input.audio.identifier,
    },
    cover: input.cover
      ? {
          service: input.cover.service.toUpperCase(),
          name: input.cover.name.trim(),
          identifier: input.cover.identifier,
        }
      : undefined,
    durationMs: input.durationMs,
    genres: input.genres,
    tags: input.tags,
    submittedAt,
  };
}

export function isListenerTrackSubmissionRecord(value: unknown): value is ListenerTrackSubmission {
  if (!isRecord(value)) {
    return false;
  }

  const candidate = value as unknown as ListenerTrackSubmission;

  return (
    candidate.schemaVersion === 1 &&
    isNonEmptyTrimmedString(candidate.submissionId) &&
    isNonEmptyTrimmedString(candidate.submitterName) &&
    isNonEmptyTrimmedString(candidate.submitterAddress) &&
    isNonEmptyTrimmedString(candidate.title) &&
    isValidQdnResourceRef(candidate.audio) &&
    (candidate.cover === undefined || isValidQdnResourceRef(candidate.cover)) &&
    isValidDurationMs(candidate.durationMs) &&
    (candidate.artist === undefined || typeof candidate.artist === 'string') &&
    (candidate.description === undefined || typeof candidate.description === 'string') &&
    (candidate.genres === undefined ||
      (Array.isArray(candidate.genres) &&
        candidate.genres.every((entry) => isNonEmptyTrimmedString(entry)))) &&
    (candidate.tags === undefined ||
      (Array.isArray(candidate.tags) &&
        candidate.tags.every((entry) => isNonEmptyTrimmedString(entry)))) &&
    isValidUtcTimestamp(candidate.submittedAt)
  );
}

export function serializeSubmissionForQdn(submission: ListenerTrackSubmission): string {
  return JSON.stringify(submission);
}

export function deserializeSubmissionFromQdn(value: unknown): ListenerTrackSubmission | null {
  return isListenerTrackSubmissionRecord(value) ? value : null;
}

/**
 * Validate immutable submission references and embedded identity claims
 * against the published QDN coordinates. Publisher/name-wallet binding is
 * verified separately by the store because it requires a live GET_NAME_DATA
 * lookup.
 */
export function validateSubmissionStructuralIntegrity(
  submission: ListenerTrackSubmission,
  publisherName: string,
  identifier: string,
): SubmissionIdentityValidation {
  if (getSubmissionQdnIdentifier(submission.submissionId) !== identifier) {
    return {
      ok: false,
      code: 'IDENTIFIER_MISMATCH',
      detail: 'Submission resource identifier does not match the submission ID.',
    };
  }

  if (
    normalizeSubmissionName(submission.submitterName) !== normalizeSubmissionName(publisherName)
  ) {
    return {
      ok: false,
      code: 'IDENTITY_UNVERIFIED',
      detail: 'Submission submitterName does not match the QDN resource publisher.',
    };
  }

  if (
    submission.audio.service.toUpperCase() !== 'AUDIO' ||
    normalizeSubmissionName(submission.audio.name) !==
      normalizeSubmissionName(submission.submitterName) ||
    submission.audio.identifier !== getSubmissionAudioQdnIdentifier(submission.submissionId)
  ) {
    return {
      ok: false,
      code: 'AUDIO_MISMATCH',
      detail: 'Submission audio reference does not match the canonical listener audio resource.',
    };
  }

  if (submission.cover !== undefined) {
    if (
      submission.cover.service.toUpperCase() !== 'IMAGE' ||
      normalizeSubmissionName(submission.cover.name) !==
        normalizeSubmissionName(submission.submitterName) ||
      submission.cover.identifier !== getSubmissionCoverQdnIdentifier(submission.submissionId)
    ) {
      return {
        ok: false,
        code: 'COVER_MISMATCH',
        detail: 'Submission cover reference does not match the canonical listener cover resource.',
      };
    }
  }

  return { ok: true };
}

// ── Moderation ─────────────────────────────────────────────────────

export function createSubmissionModeration(input: {
  moderationId: string;
  submissionId: string;
  submissionRef: QdnResourceRef;
  decision: SubmissionModerationDecision;
  acceptedTrackId?: string;
  reason?: string;
  moderatorAddress: string;
  moderatedAt?: string;
}): SubmissionModeration {
  if (!isNonEmptyTrimmedString(input.moderationId)) {
    throw new Error('Moderation ID is required.');
  }

  if (!isNonEmptyTrimmedString(input.submissionId)) {
    throw new Error('Submission ID is required for moderation.');
  }

  if (!isValidQdnResourceRef(input.submissionRef)) {
    throw new Error('Moderation submission reference must be valid.');
  }

  if (input.decision !== 'accepted' && input.decision !== 'rejected') {
    throw new Error('Moderation decision must be accepted or rejected.');
  }

  if (input.decision === 'accepted' && !isNonEmptyTrimmedString(input.acceptedTrackId)) {
    throw new Error('Accepted moderation requires an acceptedTrackId.');
  }

  if (!isNonEmptyTrimmedString(input.moderatorAddress)) {
    throw new Error('Moderator address is required.');
  }

  const moderatedAt = input.moderatedAt ?? new Date().toISOString();

  if (!isValidUtcTimestamp(moderatedAt)) {
    throw new Error('Moderation moderatedAt must be a valid UTC timestamp.');
  }

  return {
    schemaVersion: 1,
    moderationId: input.moderationId.trim(),
    submissionId: input.submissionId.trim(),
    submissionRef: input.submissionRef,
    decision: input.decision,
    acceptedTrackId: input.acceptedTrackId,
    reason: input.reason,
    moderatorAddress: input.moderatorAddress.trim(),
    moderatedAt,
  };
}

export function isSubmissionModerationRecord(value: unknown): value is SubmissionModeration {
  if (!isRecord(value)) {
    return false;
  }

  const candidate = value as unknown as SubmissionModeration;

  return (
    candidate.schemaVersion === 1 &&
    isNonEmptyTrimmedString(candidate.moderationId) &&
    isNonEmptyTrimmedString(candidate.submissionId) &&
    isValidQdnResourceRef(candidate.submissionRef) &&
    (candidate.decision === 'accepted' || candidate.decision === 'rejected') &&
    (candidate.decision === 'rejected' || isNonEmptyTrimmedString(candidate.acceptedTrackId)) &&
    (candidate.reason === undefined || typeof candidate.reason === 'string') &&
    isNonEmptyTrimmedString(candidate.moderatorAddress) &&
    isValidUtcTimestamp(candidate.moderatedAt)
  );
}

export function serializeSubmissionModerationForQdn(moderation: SubmissionModeration): string {
  return JSON.stringify(moderation);
}

export function deserializeSubmissionModerationFromQdn(
  value: unknown,
): SubmissionModeration | null {
  return isSubmissionModerationRecord(value) ? value : null;
}
