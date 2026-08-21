/* ============================================================
 * NodeFM Station — Bulk Import Publication Adapter Boundary
 *
 * This is the explicit platform/publication boundary for Bulk
 * Import. A1 provides an honest unavailable implementation only.
 * It deliberately imports no legacy QDN/Home bridge functions and
 * never converts browser File/base64 audio into a QDN transport.
 *
 * The contract is transport-neutral and batch-aware. It does not
 * name any Home action. Client `role` is intent only; final station
 * owner versus listener authority must still be enforced through the
 * existing NodeFM service/store identity checks in Workflow A2.
 * ============================================================ */

import type {
  BulkImportLocalSourceDescriptor,
  BulkImportMetadataDraft,
  BulkImportPublicationError,
  BulkImportPublicationJournal,
  BulkImportPublicationReference,
  BulkImportPublicationResourceIdentity,
  BulkImportRole,
} from './types';

export type BulkPublicationCapability =
  | { status: 'available'; message: string }
  | { status: 'unavailable'; message: string; reason: 'requires-home-2-capability' };

export type BulkPublicationRoleIntent = 'track' | 'submission';

export type BulkPublicationStepKind = 'source' | 'audio' | 'cover' | 'metadata';

export type BulkPublicationResourceStepKind = Exclude<BulkPublicationStepKind, 'source'>;

/**
 * Client-visible role intent mapping. This is an intent claim only and
 * never grants station authority by itself.
 */
export function mapBulkImportRoleToPublicationIntent(
  role: BulkImportRole,
): BulkPublicationRoleIntent {
  return role === 'admin' ? 'track' : 'submission';
}

/**
 * A row-bound acquisition result. `handleId` is an opaque adapter-owned
 * transient handle identifier, never a browser File or serialized token.
 */
export type BulkPublicationSourceDescriptor = {
  rowId: string;
  sourceGeneration: number;
  handleId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  available: boolean;
};

export type BulkPublicationActorContext = {
  name: string | null;
  address: string | null;
};

export type BulkPublicationCoverIntent = {
  origin: 'embedded' | 'manual';
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
};

export type BulkPublicationRowIntent = {
  rowId: string;
  sourceGeneration: number;
  roleIntent: BulkPublicationRoleIntent;
  source: BulkImportLocalSourceDescriptor | null;
  metadata: BulkImportMetadataDraft;
  durationMs: number | null;
  cover: BulkPublicationCoverIntent | null;
  /**
   * Current durable journal state. A future adapter uses this to skip
   * already-confirmed steps and to reconcile only uncertain outcomes.
   */
  publication: BulkImportPublicationJournal;
};

/**
 * The typed batch context passed into acquisition/publication. `role`
 * is the client-visible intent (Admin Track vs Listener Submission),
 * not a proof of authority.
 */
export type BulkPublicationIntent = {
  batchId: string;
  role: BulkImportRole;
  scope: string;
  actor: BulkPublicationActorContext;
  rows: BulkPublicationRowIntent[];
};

export type BulkPublicationSkipReason =
  'already-confirmed' | 'not-required' | 'dependency-not-ready';

type BulkPublicationStepResultIdentity = {
  batchId: string;
  rowId: string;
  sourceGeneration: number;
};

export type BulkPublicationPublishedStepResult = BulkPublicationStepResultIdentity & {
  status: 'published';
  step: BulkPublicationResourceStepKind;
  intent: BulkImportPublicationResourceIdentity;
  contentRevision: string;
  attemptId: string;
  reference: BulkImportPublicationReference;
  confirmedContentRevision: string;
  transactionSignature: string | null;
  confirmedAt: string;
};

export type BulkPublicationFailedStepResult = BulkPublicationStepResultIdentity & {
  status: 'failed';
  step: BulkPublicationResourceStepKind;
  intent: BulkImportPublicationResourceIdentity;
  contentRevision: string;
  attemptId: string;
  error: BulkImportPublicationError;
};

export type BulkPublicationUnknownStepResult = BulkPublicationStepResultIdentity & {
  status: 'unknown';
  step: BulkPublicationResourceStepKind;
  intent: BulkImportPublicationResourceIdentity;
  contentRevision: string;
  attemptId: string;
};

export type BulkPublicationAlreadyConfirmedStepResult = BulkPublicationStepResultIdentity & {
  status: 'skipped';
  reason: 'already-confirmed';
  step: BulkPublicationResourceStepKind;
  intent: BulkImportPublicationResourceIdentity;
  contentRevision: string;
  confirmed: BulkImportPublicationReference;
  confirmedAt: string;
};

export type BulkPublicationNonResourceStepResult = BulkPublicationStepResultIdentity & {
  status: 'skipped';
  reason: Exclude<BulkPublicationSkipReason, 'already-confirmed'>;
  step: BulkPublicationStepKind;
  intent: null;
  contentRevision: null;
};

export type BulkPublicationSourceStepResult = BulkPublicationStepResultIdentity & {
  status: 'published' | 'failed' | 'unknown';
  step: 'source';
  intent: null;
  contentRevision: null;
  attemptId: string;
  reference: BulkImportPublicationReference | null;
  confirmedContentRevision: null;
  transactionSignature: null;
  confirmedAt: string | null;
  error: BulkImportPublicationError | null;
};

export type BulkPublicationStepResult =
  | BulkPublicationPublishedStepResult
  | BulkPublicationFailedStepResult
  | BulkPublicationUnknownStepResult
  | BulkPublicationAlreadyConfirmedStepResult
  | BulkPublicationNonResourceStepResult
  | BulkPublicationSourceStepResult;

export type BulkPublicationRowStatus = 'complete' | 'partial' | 'failed' | 'unknown' | 'no-op';

export type BulkPublicationRowResult = {
  batchId: string;
  rowId: string;
  sourceGeneration: number;
  status: BulkPublicationRowStatus;
  steps: BulkPublicationStepResult[];
};

/**
 * Coordinated, non-atomic batch result. Successful evidence is retained
 * even when some rows or resources fail or end up unknown. The batch ID
 * is present on the result itself so a stale result can be rejected
 * without closure-local assumptions.
 */
export type BulkPublicationBatchResult = {
  batchId: string;
  rows: BulkPublicationRowResult[];
  publishedCount: number;
  failedCount: number;
  unknownCount: number;
};

export type BulkPublicationAcquisitionFailure = {
  batchId: string;
  rowId: string;
  sourceGeneration: number;
  error: BulkImportPublicationError;
};

export type BulkPublicationAcquisitionResult = {
  batchId: string;
  sources: BulkPublicationSourceDescriptor[];
  failedRows: BulkPublicationAcquisitionFailure[];
};

export type BulkPublicationAdapter = {
  capability: () => BulkPublicationCapability;
  acquirePublicationSources: (
    intent: BulkPublicationIntent,
  ) => Promise<BulkPublicationAcquisitionResult>;
  publishBatch: (
    intent: BulkPublicationIntent,
    sources: readonly BulkPublicationSourceDescriptor[],
  ) => Promise<BulkPublicationBatchResult>;
  reconcileBatch: (intent: BulkPublicationIntent) => Promise<BulkPublicationBatchResult>;
};

export type BulkPublicationStepResultClassification =
  | 'current-valid'
  | 'stale-batch'
  | 'stale-row'
  | 'stale-generation'
  | 'stale-revision'
  | 'contradictory-confirmation'
  | 'wrong-resource-kind'
  | 'malformed-result';

export type BulkPublicationStepResultValidation = {
  classification: BulkPublicationStepResultClassification;
  reason: string | null;
  result: BulkPublicationStepResult;
};

export type BulkPublicationResultCurrentContext = {
  batchId: string;
  rowId: string;
  sourceGeneration: number;
  step: BulkPublicationStepKind;
  requiredContentRevision: string | null;
};

function isNonEmptyResultString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyStringOrNull(value: unknown): value is string | null {
  return value === null || isNonEmptyResultString(value);
}

function isValidBulkImportPublicationReference(
  value: unknown,
): value is BulkImportPublicationReference {
  if (!isRecord(value)) return false;
  if (!isNonEmptyResultString(value.service) || !isNonEmptyResultString(value.name)) {
    return false;
  }

  return value.identifier === undefined || isNonEmptyResultString(value.identifier);
}

function isValidBulkImportPublicationError(value: unknown): value is BulkImportPublicationError {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyResultString(value.code) &&
    isNonEmptyResultString(value.message) &&
    typeof value.retryable === 'boolean'
  );
}

function isValidBulkImportPublicationResourceIdentity(
  value: unknown,
  expectedKind: BulkPublicationResourceStepKind,
): value is BulkImportPublicationResourceIdentity {
  if (!isRecord(value)) return false;
  if (value.kind !== expectedKind) return false;
  if (!isNonEmptyResultString(value.service)) return false;
  if (!isNonEmptyStringOrNull(value.name)) return false;
  if (!isNonEmptyStringOrNull(value.identifier)) return false;

  return true;
}

function resultHasRequiredAttemptId(value: unknown): value is string {
  return isNonEmptyResultString(value);
}

/**
 * Canonical resource-result validator. Non-resource not-required/source
 * outcomes are intentionally outside the resource publication identity
 * invariant and are therefore treated as malformed here; callers that
 * need to accept a not-required skip should branch on its reason first.
 */
export function validateBulkPublicationStepResultAgainstCurrentRow(
  result: BulkPublicationStepResult,
  current: BulkPublicationResultCurrentContext,
): BulkPublicationStepResultValidation {
  const invalid = (
    classification: Exclude<BulkPublicationStepResultClassification, 'current-valid'>,
    reason: string,
  ): BulkPublicationStepResultValidation => ({
    classification,
    reason,
    result,
  });

  if (!result || typeof result !== 'object') {
    return invalid('malformed-result', 'Result is not a publication step object.');
  }

  if (result.batchId !== current.batchId) {
    return invalid('stale-batch', 'Result belongs to a different batch.');
  }
  if (result.rowId !== current.rowId) {
    return invalid('stale-row', 'Result belongs to a different row.');
  }
  if (result.sourceGeneration !== current.sourceGeneration) {
    return invalid('stale-generation', 'Result belongs to a different source generation.');
  }
  if (result.step !== current.step) {
    return invalid('wrong-resource-kind', 'Result step does not match the current row step.');
  }

  if (result.status === 'skipped' && result.reason !== 'already-confirmed') {
    return invalid(
      'malformed-result',
      'Not-required or source skip is not a resource publication outcome.',
    );
  }

  const isResourceStep =
    result.step === 'audio' || result.step === 'cover' || result.step === 'metadata';
  if (!isResourceStep) {
    return invalid(
      'wrong-resource-kind',
      'Source-level outcomes do not carry resource publication identity.',
    );
  }

  if (
    result.status !== 'published' &&
    result.status !== 'failed' &&
    result.status !== 'unknown' &&
    result.status !== 'skipped'
  ) {
    return invalid('malformed-result', 'Unknown result status.');
  }

  const intent = result.intent;
  if (!intent || intent.kind !== result.step) {
    return invalid('wrong-resource-kind', 'Result resource intent does not match its step kind.');
  }
  if (!isValidBulkImportPublicationResourceIdentity(intent, result.step)) {
    return invalid('malformed-result', 'Result resource intent is structurally incomplete.');
  }

  const contentRevision = result.contentRevision;
  if (!isNonEmptyResultString(contentRevision)) {
    return invalid('malformed-result', 'Resource result is missing its intended content revision.');
  }

  if (!resultHasRequiredAttemptId((result as { attemptId?: unknown }).attemptId)) {
    return invalid('malformed-result', 'Resource result is missing its attempt identity.');
  }

  if (result.status === 'published') {
    const published = result as Extract<BulkPublicationStepResult, { status: 'published' }>;
    if (!isValidBulkImportPublicationReference(published.reference)) {
      return invalid('malformed-result', 'Published result has a malformed confirmed reference.');
    }
    if (!isNonEmptyResultString(published.confirmedAt)) {
      return invalid('malformed-result', 'Published result is missing confirmed evidence.');
    }
    if (
      published.transactionSignature !== null &&
      typeof published.transactionSignature !== 'string'
    ) {
      return invalid('malformed-result', 'Published result has a malformed transaction signature.');
    }
    if (published.confirmedContentRevision !== contentRevision) {
      return invalid(
        'contradictory-confirmation',
        'Confirmed content revision contradicts the intended revision.',
      );
    }
  }

  if (result.status === 'failed') {
    const failed = result as Extract<BulkPublicationStepResult, { status: 'failed' }>;
    if (!isValidBulkImportPublicationError(failed.error)) {
      return invalid('malformed-result', 'Failed result has a malformed classified error.');
    }
  }

  if (result.status === 'skipped') {
    const skipped = result as Extract<
      BulkPublicationStepResult,
      { status: 'skipped'; reason: 'already-confirmed' }
    >;
    if (
      !isValidBulkImportPublicationReference(skipped.confirmed) ||
      !isNonEmptyResultString(skipped.confirmedAt)
    ) {
      return invalid('malformed-result', 'Already-confirmed skip is missing durable evidence.');
    }
  }

  if (
    current.requiredContentRevision === null ||
    contentRevision !== current.requiredContentRevision
  ) {
    return invalid(
      'stale-revision',
      'Result revision does not match the current required row revision.',
    );
  }

  return { classification: 'current-valid', reason: null, result };
}

export function isBulkPublicationStepResultCurrent(
  result: BulkPublicationStepResult,
  batchId: string,
  rowId: string,
  sourceGeneration: number,
  intendedRevision?: string | null,
): boolean {
  const requiredContentRevision =
    intendedRevision ??
    (result.status === 'published' ||
    result.status === 'failed' ||
    result.status === 'unknown' ||
    (result.status === 'skipped' && result.reason === 'already-confirmed')
      ? result.contentRevision
      : null);

  return (
    validateBulkPublicationStepResultAgainstCurrentRow(result, {
      batchId,
      rowId,
      sourceGeneration,
      step: result.step,
      requiredContentRevision,
    }).classification === 'current-valid'
  );
}

export function isBulkPublicationRowResultCurrent(
  result: BulkPublicationRowResult,
  batchId: string,
  rowId: string,
  sourceGeneration: number,
): boolean {
  return (
    result.batchId === batchId &&
    result.rowId === rowId &&
    result.sourceGeneration === sourceGeneration
  );
}

export class BulkPublicationUnavailableError extends Error {
  constructor() {
    super('Bulk publication requires the upcoming Qortium Home capability.');
    this.name = 'BulkPublicationUnavailableError';
  }
}

export const unavailableBulkPublicationAdapter: BulkPublicationAdapter = {
  capability: () => ({
    status: 'unavailable',
    reason: 'requires-home-2-capability',
    message: 'Bulk publication requires the upcoming Qortium Home capability.',
  }),
  acquirePublicationSources: async () => {
    throw new BulkPublicationUnavailableError();
  },
  publishBatch: async () => {
    throw new BulkPublicationUnavailableError();
  },
  reconcileBatch: async () => {
    throw new BulkPublicationUnavailableError();
  },
};
