/* ============================================================
 * NodeFM Station — Listener Playlist Submission Domain Service
 *
 * A listener playlist submission is an immutable listener-owned record
 * pointing at an exact published listener PlaylistVersion. The station
 * owner publishes a separate station-owned moderation record. The
 * station never consumes the listener's mutable logical playlist.
 * ============================================================ */

import { generateId } from '../../../utils/id';
import { isRecord } from '../../../utils/record';
import { isNonEmptyTrimmedString } from '../../../utils/validation';
import type { QdnResourceRef } from '../../../types/domain';

export const LISTENER_PLAYLIST_SUBMISSION_QDN_SERVICE = 'JSON';
export const LISTENER_PLAYLIST_SUBMISSION_IDENTIFIER_PREFIX = 'nodefm-lp-sub-';
export const LISTENER_PLAYLIST_SUBMISSION_MODERATION_IDENTIFIER_PREFIX = 'nodefm-lp-sub-mod-';

const MAX_IDENTIFIER_LENGTH = 64;

export type ListenerPlaylistSubmission = {
  schemaVersion: 1;
  submissionId: string;
  listenerName: string;
  listenerAddress: string;
  playlistId: string;
  playlistTitle: string;
  versionId: string;
  versionRef: QdnResourceRef;
  submittedAt: string;
};

export type ListenerPlaylistSubmissionModeration = {
  schemaVersion: 1;
  moderationId: string;
  submissionId: string;
  submissionRef: QdnResourceRef;
  decision: 'accepted' | 'rejected';
  importedPlaylistId?: string;
  importedVersionId?: string;
  moderatorAddress: string;
  moderatedAt: string;
  reason?: string;
};

function assertIdentifierLength(identifier: string): void {
  if (identifier.length > MAX_IDENTIFIER_LENGTH) {
    throw new Error(`QDN identifier exceeds ${MAX_IDENTIFIER_LENGTH} bytes.`);
  }
}

export function getListenerPlaylistSubmissionQdnIdentifier(submissionId: string): string {
  if (!isNonEmptyTrimmedString(submissionId)) {
    throw new Error('Playlist submission ID is required.');
  }

  const identifier = `${LISTENER_PLAYLIST_SUBMISSION_IDENTIFIER_PREFIX}${submissionId.trim()}`;
  assertIdentifierLength(identifier);
  return identifier;
}

export function getListenerPlaylistSubmissionModerationQdnIdentifier(submissionId: string): string {
  if (!isNonEmptyTrimmedString(submissionId)) {
    throw new Error('Playlist submission ID is required for moderation.');
  }

  const identifier = `${LISTENER_PLAYLIST_SUBMISSION_MODERATION_IDENTIFIER_PREFIX}${submissionId.trim()}`;
  assertIdentifierLength(identifier);
  return identifier;
}

export function isValidUtcTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim() !== '' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value.trim()) &&
    Number.isFinite(Date.parse(value))
  );
}

function isValidQdnResourceRef(value: unknown): value is QdnResourceRef {
  return (
    isRecord(value) &&
    isNonEmptyTrimmedString(value.service) &&
    isNonEmptyTrimmedString(value.name) &&
    (value.identifier === undefined || isNonEmptyTrimmedString(value.identifier))
  );
}

export function createListenerPlaylistSubmission(input: {
  submissionId?: string;
  listenerName: string;
  listenerAddress: string;
  playlistId: string;
  playlistTitle: string;
  versionId: string;
  versionRef: QdnResourceRef;
  submittedAt?: string;
}): ListenerPlaylistSubmission {
  if (!isNonEmptyTrimmedString(input.listenerName)) {
    throw new Error('A registered Qortium name is required.');
  }

  if (!isNonEmptyTrimmedString(input.listenerAddress)) {
    throw new Error('An authenticated account is required.');
  }

  if (!isNonEmptyTrimmedString(input.playlistId)) {
    throw new Error('Playlist ID is required.');
  }

  if (!isNonEmptyTrimmedString(input.playlistTitle)) {
    throw new Error('Playlist title is required.');
  }

  if (!isNonEmptyTrimmedString(input.versionId)) {
    throw new Error('Playlist version ID is required.');
  }

  if (!isValidQdnResourceRef(input.versionRef)) {
    throw new Error('A valid listener PlaylistVersion resource reference is required.');
  }

  const submittedAt = input.submittedAt ?? new Date().toISOString();
  if (!isValidUtcTimestamp(submittedAt)) {
    throw new Error('Submission submittedAt must be a valid UTC timestamp.');
  }

  return {
    schemaVersion: 1,
    submissionId: input.submissionId?.trim() || generateId(),
    listenerName: input.listenerName.trim(),
    listenerAddress: input.listenerAddress.trim(),
    playlistId: input.playlistId.trim(),
    playlistTitle: input.playlistTitle.trim(),
    versionId: input.versionId.trim(),
    versionRef: {
      service: input.versionRef.service.trim(),
      name: input.versionRef.name.trim(),
      identifier: input.versionRef.identifier?.trim(),
    },
    submittedAt,
  };
}

export function createListenerPlaylistSubmissionModeration(input: {
  moderationId?: string;
  submissionId: string;
  submissionRef: QdnResourceRef;
  decision: 'accepted' | 'rejected';
  importedPlaylistId?: string;
  importedVersionId?: string;
  moderatorAddress: string;
  moderatedAt?: string;
  reason?: string;
}): ListenerPlaylistSubmissionModeration {
  if (!isNonEmptyTrimmedString(input.submissionId)) {
    throw new Error('Playlist submission ID is required for moderation.');
  }

  if (!isValidQdnResourceRef(input.submissionRef)) {
    throw new Error('A valid playlist submission resource reference is required.');
  }

  if (input.decision !== 'accepted' && input.decision !== 'rejected') {
    throw new Error('Moderation decision must be accepted or rejected.');
  }

  if (input.decision === 'accepted' && !isNonEmptyTrimmedString(input.importedPlaylistId)) {
    throw new Error('Accepted playlist moderation requires importedPlaylistId.');
  }

  if (input.decision === 'accepted' && !isNonEmptyTrimmedString(input.importedVersionId)) {
    throw new Error('Accepted playlist moderation requires importedVersionId.');
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
    moderationId: input.moderationId?.trim() || generateId(),
    submissionId: input.submissionId.trim(),
    submissionRef: input.submissionRef,
    decision: input.decision,
    importedPlaylistId: input.importedPlaylistId,
    importedVersionId: input.importedVersionId,
    moderatorAddress: input.moderatorAddress.trim(),
    moderatedAt,
    reason: input.reason,
  };
}

export function serializeListenerPlaylistSubmission(
  submission: ListenerPlaylistSubmission,
): string {
  return JSON.stringify(submission);
}

export function deserializeListenerPlaylistSubmission(
  value: unknown,
): ListenerPlaylistSubmission | null {
  if (!isRecord(value)) {
    return null;
  }

  const candidate = value as unknown as ListenerPlaylistSubmission;

  if (
    candidate.schemaVersion !== 1 ||
    !isNonEmptyTrimmedString(candidate.submissionId) ||
    !isNonEmptyTrimmedString(candidate.listenerName) ||
    !isNonEmptyTrimmedString(candidate.listenerAddress) ||
    !isNonEmptyTrimmedString(candidate.playlistId) ||
    !isNonEmptyTrimmedString(candidate.playlistTitle) ||
    !isNonEmptyTrimmedString(candidate.versionId) ||
    !isValidQdnResourceRef(candidate.versionRef) ||
    !isValidUtcTimestamp(candidate.submittedAt)
  ) {
    return null;
  }

  return candidate;
}

export function serializeListenerPlaylistSubmissionModeration(
  moderation: ListenerPlaylistSubmissionModeration,
): string {
  return JSON.stringify(moderation);
}

export function deserializeListenerPlaylistSubmissionModeration(
  value: unknown,
): ListenerPlaylistSubmissionModeration | null {
  if (!isRecord(value)) {
    return null;
  }

  const candidate = value as unknown as ListenerPlaylistSubmissionModeration;

  if (
    candidate.schemaVersion !== 1 ||
    !isNonEmptyTrimmedString(candidate.moderationId) ||
    !isNonEmptyTrimmedString(candidate.submissionId) ||
    !isValidQdnResourceRef(candidate.submissionRef) ||
    (candidate.decision !== 'accepted' && candidate.decision !== 'rejected') ||
    (candidate.decision === 'accepted' &&
      (!isNonEmptyTrimmedString(candidate.importedPlaylistId) ||
        !isNonEmptyTrimmedString(candidate.importedVersionId))) ||
    !isNonEmptyTrimmedString(candidate.moderatorAddress) ||
    !isValidUtcTimestamp(candidate.moderatedAt)
  ) {
    return null;
  }

  return candidate;
}

export function isListenerPlaylistSubmissionIdentifier(value: string): boolean {
  return value.startsWith(LISTENER_PLAYLIST_SUBMISSION_IDENTIFIER_PREFIX);
}

export function isListenerPlaylistSubmissionModerationIdentifier(value: string): boolean {
  return value.startsWith(LISTENER_PLAYLIST_SUBMISSION_MODERATION_IDENTIFIER_PREFIX);
}
