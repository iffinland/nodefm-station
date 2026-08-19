/* ============================================================
 * NodeFM Station — Like Domain Service
 *
 * Independent per-user/per-track like records, QDN identity,
 * deterministic reduction, and liked-track ranking.
 *
 * A Like is a user operation, not a mutable global count on the
 * Track. The reducer accepts only records whose QDN publisher
 * name matches the claimed publisher and whose claimed wallet
 * address matches the verified Qortium name owner.
 * ============================================================ */

import { isNonEmptyTrimmedString } from '../../../utils/validation';

export const LIKE_QDN_SERVICE = 'JSON';
export const LIKE_IDENTIFIER_PREFIX = 'nodefm-like-';

export type LikeState = 'active' | 'inactive';

export type TrackLikeBody = {
  operation: 'like';
  targetType: 'track';
  targetId: string;
  state: LikeState;
  publisherName: string;
  walletAddress: string;
};

export type TrackLikeEnvelope = {
  schema: 'nodefm-v1';
  schemaVersion: 1;
  kind: 'operation';
  recordType: 'track-like';
  recordId: string;
  targetId: string;
  body: TrackLikeBody;
  clientCreatedAt?: string;
};

export type LikeResourceMetadata = {
  service: string;
  publisherName: string;
  identifier: string;
  created: number;
  updated: number | null;
};

export type TrackLikeRecord = {
  metadata: LikeResourceMetadata;
  envelope: TrackLikeEnvelope;
};

export type LikeDiagnosticCode =
  | 'INVALID_METADATA'
  | 'MALFORMED_ENVELOPE'
  | 'TARGET_MISMATCH'
  | 'IDENTIFIER_MISMATCH'
  | 'IDENTITY_UNVERIFIED'
  | 'DUPLICATE_CONFLICT';

export type LikeDiagnostic = {
  code: LikeDiagnosticCode;
  identifier: string;
  detail: string;
};

export type LikeValidationResult =
  { ok: true } | { ok: false; code: LikeDiagnosticCode; detail: string };

export type LikeIdentityValidator = {
  validatePublisher: (
    metadata: LikeResourceMetadata,
    claimedPublisherName: string,
  ) => LikeValidationResult;
  validateWalletBinding: (publisherName: string, walletAddress: string) => LikeValidationResult;
};

export type TrackLikeAggregate = {
  trackId: string;
  count: number;
  likerAddresses: string[];
  actors: Record<string, TrackLikeBody>;
  diagnostics: LikeDiagnostic[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

export function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeWalletAddress(value: string): string {
  return value.trim();
}

function fnv1aHash(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x01000193;

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first ^= code;
    first = Math.imul(first, 0x01000193);
    second ^= code;
    second = Math.imul(second, 0x85ebca6b);
  }

  const firstHex = (first >>> 0).toString(16).padStart(8, '0');
  const secondHex = (second >>> 0).toString(16).padStart(8, '0');

  return `${firstHex.slice(0, 6)}${secondHex.slice(0, 6)}`;
}

/**
 * Build a deterministic QDN identifier for one effective actor/target
 * pair. The target is a track ID; the actor is the verified wallet
 * address. QDN `name` remains the publisher's registered Qortium name.
 */
export function buildTrackLikeIdentifier(trackId: string, walletAddress: string): string {
  const normalizedTrackId = trackId.trim();
  const normalizedWalletAddress = normalizeWalletAddress(walletAddress);

  if (!normalizedTrackId || !normalizedWalletAddress) {
    throw new Error('Track ID and wallet address are required for a Like identifier.');
  }

  return `${LIKE_IDENTIFIER_PREFIX}${normalizedTrackId}-${fnv1aHash(normalizedWalletAddress)}`;
}

export function buildTrackLikeEnvelope(
  body: TrackLikeBody,
  recordId: string,
  clientCreatedAt = new Date().toISOString(),
): TrackLikeEnvelope {
  return {
    schema: 'nodefm-v1',
    schemaVersion: 1,
    kind: 'operation',
    recordType: 'track-like',
    recordId,
    targetId: body.targetId,
    body,
    clientCreatedAt,
  };
}

export function isTrackLikeEnvelope(value: unknown): value is TrackLikeEnvelope {
  if (!isRecord(value) || !isRecord(value.body)) {
    return false;
  }

  const body = value.body;

  return (
    hasOnlyKeys(value, [
      'schema',
      'schemaVersion',
      'kind',
      'recordType',
      'recordId',
      'targetId',
      'body',
      'clientCreatedAt',
    ]) &&
    hasOnlyKeys(body, [
      'operation',
      'targetType',
      'targetId',
      'state',
      'publisherName',
      'walletAddress',
    ]) &&
    value.schema === 'nodefm-v1' &&
    value.schemaVersion === 1 &&
    value.kind === 'operation' &&
    value.recordType === 'track-like' &&
    typeof value.recordId === 'string' &&
    value.recordId.trim().length > 0 &&
    typeof value.targetId === 'string' &&
    value.targetId.trim().length > 0 &&
    (value.clientCreatedAt === undefined || typeof value.clientCreatedAt === 'string') &&
    body.operation === 'like' &&
    body.targetType === 'track' &&
    typeof body.targetId === 'string' &&
    body.targetId === value.targetId &&
    (body.state === 'active' || body.state === 'inactive') &&
    isNonEmptyTrimmedString(body.publisherName) &&
    isNonEmptyTrimmedString(body.walletAddress)
  );
}

export function classifyInvalidTrackLikeEnvelope(value: unknown): LikeDiagnosticCode {
  if (!isRecord(value) || !isRecord(value.body)) {
    return 'MALFORMED_ENVELOPE';
  }

  if (
    typeof value.targetId === 'string' &&
    typeof value.body.targetId === 'string' &&
    value.targetId !== value.body.targetId
  ) {
    return 'TARGET_MISMATCH';
  }

  if (
    value.schema === 'nodefm-v1' &&
    value.schemaVersion === 1 &&
    value.kind === 'operation' &&
    value.recordType === 'track-like' &&
    value.body.operation === 'like' &&
    value.body.targetType === 'track' &&
    typeof value.body.state === 'string' &&
    value.body.state !== 'active' &&
    value.body.state !== 'inactive'
  ) {
    return 'MALFORMED_ENVELOPE';
  }

  return 'MALFORMED_ENVELOPE';
}

export function validateLikeMetadata(metadata: LikeResourceMetadata): LikeValidationResult {
  if (
    !metadata.service ||
    !metadata.publisherName ||
    !metadata.identifier ||
    !Number.isSafeInteger(metadata.created) ||
    (metadata.updated !== null &&
      (!Number.isSafeInteger(metadata.updated) || metadata.created > metadata.updated))
  ) {
    return {
      ok: false,
      code: 'INVALID_METADATA',
      detail: 'missing or invalid trusted Like resource metadata',
    };
  }

  return { ok: true };
}

function compareRecords(left: TrackLikeRecord, right: TrackLikeRecord): number {
  const leftTime = left.metadata.updated ?? left.metadata.created;
  const rightTime = right.metadata.updated ?? right.metadata.created;

  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }

  return left.metadata.identifier.localeCompare(right.metadata.identifier);
}

function sortDiagnostics(diagnostics: LikeDiagnostic[]): LikeDiagnostic[] {
  return diagnostics.sort(
    (left, right) =>
      left.identifier.localeCompare(right.identifier) ||
      left.code.localeCompare(right.code) ||
      left.detail.localeCompare(right.detail),
  );
}

export function reduceTrackLikeRecords(
  targetTrackId: string,
  records: TrackLikeRecord[],
  identity: LikeIdentityValidator,
): TrackLikeAggregate {
  const diagnostics: LikeDiagnostic[] = [];
  const actorRecords = new Map<string, TrackLikeRecord[]>();

  for (const record of [...records].sort(compareRecords)) {
    const metadata = validateLikeMetadata(record.metadata);
    if (!metadata.ok) {
      diagnostics.push({
        code: metadata.code,
        identifier: record.metadata.identifier,
        detail: metadata.detail,
      });
      continue;
    }

    const envelope = record.envelope;
    if (envelope.targetId !== targetTrackId || envelope.body.targetId !== targetTrackId) {
      diagnostics.push({
        code: 'TARGET_MISMATCH',
        identifier: record.metadata.identifier,
        detail: 'like target mismatch',
      });
      continue;
    }

    const publisher = identity.validatePublisher(record.metadata, envelope.body.publisherName);
    if (!publisher.ok) {
      diagnostics.push({
        code: publisher.code,
        identifier: record.metadata.identifier,
        detail: publisher.detail,
      });
      continue;
    }

    const wallet = identity.validateWalletBinding(
      envelope.body.publisherName,
      envelope.body.walletAddress,
    );
    if (!wallet.ok) {
      diagnostics.push({
        code: wallet.code,
        identifier: record.metadata.identifier,
        detail: wallet.detail,
      });
      continue;
    }

    const actorKey = normalizeWalletAddress(envelope.body.walletAddress);
    actorRecords.set(actorKey, [...(actorRecords.get(actorKey) ?? []), record]);
  }

  const actors: Record<string, TrackLikeBody> = {};
  for (const [actorKey, recordsForActor] of [...actorRecords.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const ordered = [...recordsForActor].sort(compareRecords);
    const latest = ordered[ordered.length - 1];
    if (!latest) {
      continue;
    }

    const tiedLatest = ordered.filter((record) => compareRecords(record, latest) === 0);
    const states = new Set(tiedLatest.map((record) => record.envelope.body.state));

    if (states.size > 1) {
      diagnostics.push({
        code: 'DUPLICATE_CONFLICT',
        identifier: latest.metadata.identifier,
        detail: `conflicting Like states share the same trusted ordering key for actor ${actorKey}`,
      });
      continue;
    }

    actors[actorKey] = latest.envelope.body;
  }

  const likerAddresses = Object.values(actors)
    .filter((body) => body.state === 'active')
    .map((body) => normalizeWalletAddress(body.walletAddress))
    .sort((left, right) => left.localeCompare(right));

  return {
    trackId: targetTrackId,
    count: likerAddresses.length,
    likerAddresses,
    actors,
    diagnostics: sortDiagnostics(diagnostics),
  };
}

export function hasActiveLike(aggregate: TrackLikeAggregate, walletAddress: string): boolean {
  return aggregate.actors[normalizeWalletAddress(walletAddress)]?.state === 'active';
}

export function aggregateLikeRecordsForTrackIds(
  records: TrackLikeRecord[],
  trackIds: Iterable<string>,
  identity: LikeIdentityValidator,
): Record<string, TrackLikeAggregate> {
  const result: Record<string, TrackLikeAggregate> = {};

  for (const trackId of new Set(trackIds)) {
    result[trackId] = reduceTrackLikeRecords(trackId, records, identity);
  }

  return result;
}

export type RankedLikedTrack = {
  trackId: string;
  likeCount: number;
  likerAddresses: string[];
};

/**
 * Rank eligible liked tracks by most-liked first, then by track ID
 * ascending as a stable, documentable tie-breaker.
 */
export function rankLikedTracks(
  records: TrackLikeRecord[],
  eligibleTrackIds: Iterable<string>,
  identity: LikeIdentityValidator,
): RankedLikedTrack[] {
  const aggregateByTrack = aggregateLikeRecordsForTrackIds(records, eligibleTrackIds, identity);

  return Object.values(aggregateByTrack)
    .filter((aggregate) => aggregate.count > 0)
    .map((aggregate) => ({
      trackId: aggregate.trackId,
      likeCount: aggregate.count,
      likerAddresses: aggregate.likerAddresses,
    }))
    .sort((left, right) => {
      if (right.likeCount !== left.likeCount) {
        return right.likeCount - left.likeCount;
      }

      return left.trackId.localeCompare(right.trackId);
    });
}

export function serializeTrackLikeEnvelopeForQdn(envelope: TrackLikeEnvelope): string {
  return JSON.stringify(envelope);
}

export function deserializeTrackLikeEnvelopeFromQdn(value: unknown): TrackLikeEnvelope | null {
  return isTrackLikeEnvelope(value) ? value : null;
}
