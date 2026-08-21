/* ============================================================
 * NodeFM Station — Bulk Import Publication Journal
 *
 * Versioned, evidence-bearing publication state helpers. These
 * helpers define deterministic invalidation rules so a draft change
 * can never leave a stale "published"/"complete" claim behind.
 * ============================================================ */

import {
  computeAudioContentRevision,
  computeCoverContentRevision,
  computeMetadataContentRevision,
} from './contentRevision';
import type {
  BulkImportCoverDraft,
  BulkImportLocalSourceDescriptor,
  BulkImportMetadataDraft,
  BulkImportPublicationAttempt,
  BulkImportPublicationError,
  BulkImportPublicationFailedStep,
  BulkImportPublicationInProgressStep,
  BulkImportPublicationJournal,
  BulkImportPublicationPublishedStep,
  BulkImportPublicationReference,
  BulkImportPublicationResourceIdentity,
  BulkImportPublicationSource,
  BulkImportPublicationStep,
  BulkImportPublicationStepStatus,
  BulkImportPublicationUnknownStep,
} from './types';

export const BULK_IMPORT_PUBLICATION_JOURNAL_SCHEMA_VERSION = 2;

export function createEmptyPublicationAttempt(): BulkImportPublicationAttempt {
  return {
    attemptId: '',
    startedAt: null,
    finishedAt: null,
  };
}

export function createEmptyPublicationSource(): BulkImportPublicationSource {
  return {
    status: 'not-started',
    attempt: null,
    updatedAt: null,
  };
}

export function createEmptyPublicationStep(): BulkImportPublicationStep {
  return {
    status: 'not-started',
    updatedAt: null,
  };
}

export function createEmptyPublicationJournal(): BulkImportPublicationJournal {
  return {
    schemaVersion: BULK_IMPORT_PUBLICATION_JOURNAL_SCHEMA_VERSION,
    source: createEmptyPublicationSource(),
    audio: createEmptyPublicationStep(),
    cover: createEmptyPublicationStep(),
    metadata: createEmptyPublicationStep(),
  };
}

export function publicationStepStatus(
  step: BulkImportPublicationStep,
): BulkImportPublicationStepStatus {
  return step.status;
}

export function isPublishedPublicationStep(
  step: BulkImportPublicationStep,
): step is BulkImportPublicationPublishedStep {
  return step.status === 'published';
}

export function isUnknownPublicationStep(
  step: BulkImportPublicationStep,
): step is BulkImportPublicationUnknownStep {
  return step.status === 'unknown';
}

export function isFailedPublicationStep(
  step: BulkImportPublicationStep,
): step is BulkImportPublicationFailedStep {
  return step.status === 'failed';
}

export function isInProgressPublicationStep(
  step: BulkImportPublicationStep,
): step is BulkImportPublicationInProgressStep {
  return step.status === 'in-progress';
}

export function createInProgressPublicationStep(input: {
  intent: BulkImportPublicationResourceIdentity;
  attemptId?: string;
  startedAt?: string | null;
  updatedAt?: string | null;
}): BulkImportPublicationInProgressStep {
  return {
    status: 'in-progress',
    intent: input.intent,
    attempt: {
      attemptId: input.attemptId ?? '',
      startedAt: input.startedAt ?? new Date().toISOString(),
      finishedAt: null,
    },
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  };
}

export function createFailedPublicationStep(input: {
  intent?: BulkImportPublicationResourceIdentity | null;
  attempt?: BulkImportPublicationAttempt | null;
  error?: BulkImportPublicationError | null;
  updatedAt?: string | null;
}): BulkImportPublicationFailedStep {
  return {
    status: 'failed',
    intent: input.intent ?? null,
    attempt: input.attempt ?? null,
    error: input.error ?? null,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  };
}

export function createUnknownPublicationStep(input: {
  intent: BulkImportPublicationResourceIdentity;
  attemptId: string;
  contentRevision: string;
  sourceGeneration: number;
  reference?: BulkImportPublicationReference | null;
  startedAt?: string | null;
  updatedAt?: string | null;
}): BulkImportPublicationUnknownStep {
  return {
    status: 'unknown',
    intent: input.intent,
    attempt: {
      attemptId: input.attemptId,
      startedAt: input.startedAt ?? new Date().toISOString(),
      finishedAt: null,
    },
    contentRevision: input.contentRevision,
    sourceGeneration: input.sourceGeneration,
    reference: input.reference ?? null,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  };
}

export function createPublishedPublicationStep(input: {
  intent: BulkImportPublicationResourceIdentity;
  confirmed: BulkImportPublicationReference;
  contentRevision: string;
  attemptId: string;
  startedAt?: string | null;
  confirmedAt: string;
  transactionSignature?: string | null;
  updatedAt?: string | null;
}): BulkImportPublicationPublishedStep {
  return {
    status: 'published',
    intent: input.intent,
    confirmed: input.confirmed,
    contentRevision: input.contentRevision,
    attempt: {
      attemptId: input.attemptId,
      startedAt: input.startedAt ?? null,
      finishedAt: input.confirmedAt,
    },
    transactionSignature: input.transactionSignature ?? null,
    confirmedAt: input.confirmedAt,
    updatedAt: input.updatedAt ?? input.confirmedAt,
  };
}

/**
 * A published step is trustworthy only when it still matches the exact
 * current content. This is the canonical published-evidence invariant.
 */
export function publicationStepMatchesContent(
  step: BulkImportPublicationStep,
  kind: BulkImportPublicationResourceIdentity['kind'],
  expectedRevision: string | null,
): step is BulkImportPublicationPublishedStep {
  return (
    isPublishedPublicationStep(step) &&
    expectedRevision !== null &&
    step.contentRevision === expectedRevision &&
    step.intent.kind === kind
  );
}

export function getRequiredPublicationContentRevision(
  kind: BulkImportPublicationResourceIdentity['kind'],
  input: {
    sourceGeneration: number;
    source: BulkImportLocalSourceDescriptor | null;
    metadata: BulkImportMetadataDraft;
    cover: BulkImportCoverDraft | null;
  },
): string | null {
  if (kind === 'audio') {
    return computeAudioContentRevision(input.source, input.sourceGeneration);
  }
  if (kind === 'cover') return computeCoverContentRevision(input.cover);
  return computeMetadataContentRevision(input.metadata);
}

export function getUnknownPublicationSteps(journal: BulkImportPublicationJournal): Array<{
  step: BulkImportPublicationResourceIdentity['kind'];
  record: BulkImportPublicationUnknownStep;
}> {
  const result: Array<{
    step: BulkImportPublicationResourceIdentity['kind'];
    record: BulkImportPublicationUnknownStep;
  }> = [];

  for (const key of ['audio', 'cover', 'metadata'] as const) {
    const record = journal[key];
    if (isUnknownPublicationStep(record)) {
      result.push({ step: key, record });
    }
  }

  return result;
}

/**
 * Replace an audio source. Audio-dependent work and downstream metadata
 * publication are always invalidated. A cover is invalidated only when
 * it originated from the replaced audio; a manual cover is retained.
 */
export function invalidatePublicationForSourceChange(
  journal: BulkImportPublicationJournal,
  coverCameFromAudio: boolean,
): BulkImportPublicationJournal {
  return {
    schemaVersion: BULK_IMPORT_PUBLICATION_JOURNAL_SCHEMA_VERSION,
    source: createEmptyPublicationSource(),
    audio: createEmptyPublicationStep(),
    cover: coverCameFromAudio ? createEmptyPublicationStep() : journal.cover,
    metadata: createEmptyPublicationStep(),
  };
}

/**
 * A metadata edit invalidates only the metadata publication step. Audio
 * and cover resources are not affected by a draft metadata change.
 */
export function invalidatePublicationForMetadataChange(
  journal: BulkImportPublicationJournal,
): BulkImportPublicationJournal {
  return {
    ...journal,
    metadata: createEmptyPublicationStep(),
  };
}

/**
 * A cover change invalidates the cover step and the metadata step,
 * because published metadata references the cover when one exists.
 */
export function invalidatePublicationForCoverChange(
  journal: BulkImportPublicationJournal,
): BulkImportPublicationJournal {
  return {
    ...journal,
    cover: createEmptyPublicationStep(),
    metadata: createEmptyPublicationStep(),
  };
}

export function publicationStepHasError(error: BulkImportPublicationError | null): boolean {
  return error !== null && error.code.trim().length > 0;
}
