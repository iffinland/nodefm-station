/* ============================================================
 * NodeFM Station — Bulk Import Home 2 Publication Reducer
 *
 * Pure application of A2 adapter results into the frozen A1 batch
 * journal. Every resource result is revalidated against the exact
 * current batch/row/source-generation/audio revision before a
 * journal record is advanced.
 * ============================================================ */

import { computeAudioContentRevision, computeCoverContentRevision } from './contentRevision';
import {
  validateBulkPublicationStepResultAgainstCurrentRow,
  type BulkPublicationRowResult,
  type BulkPublicationSourceDescriptor,
  type BulkPublicationStepResult,
} from './publicationAdapter';
import {
  createFailedPublicationStep,
  createPublishedPublicationStep,
  createUnknownPublicationStep,
  getRequiredPublicationContentRevision,
  isFailedPublicationStep,
  isUnknownPublicationStep,
  publicationStepMatchesContent,
} from './publicationJournal';
import type {
  BulkImportBatch,
  BulkImportPublicationJournal,
  BulkImportPublicationResourceIdentity,
  BulkImportPublicationStep,
  BulkImportRow,
} from './types';

export type Home2RowPublicationUiState =
  | 'staged'
  | 'native-source-required'
  | 'native-source-acquired'
  | 'publishing'
  | 'audio-published'
  | 'failed'
  | 'unknown';

function replaceRow(
  batch: BulkImportBatch,
  rowId: string,
  update: (row: BulkImportRow) => BulkImportRow,
): BulkImportBatch {
  const index = batch.rows.findIndex((row) => row.id === rowId);
  if (index === -1) return batch;

  const rows = [...batch.rows];
  rows[index] = update(rows[index]);
  return { ...batch, rows, updatedAt: new Date().toISOString() };
}

function replaceJournal(
  batch: BulkImportBatch,
  rowId: string,
  update: (journal: BulkImportPublicationJournal) => BulkImportPublicationJournal,
): BulkImportBatch {
  return replaceRow(batch, rowId, (row) => ({
    ...row,
    publication: update(row.publication),
  }));
}

/**
 * Record a successful native source acquisition on the transient journal.
 * `handleId` is the NodeFM logical handle ID, never the Home source token.
 */
export function applyBulkPublicationSourceAcquisitionToBatch(
  batch: BulkImportBatch,
  source: BulkPublicationSourceDescriptor,
): BulkImportBatch {
  const row = batch.rows.find((candidate) => candidate.id === source.rowId);
  if (!row || row.sourceGeneration !== source.sourceGeneration) {
    return batch;
  }

  const now = new Date().toISOString();
  return replaceJournal(batch, source.rowId, (journal) => ({
    ...journal,
    source: {
      status: 'acquired',
      attempt: {
        attemptId: source.handleId,
        startedAt: now,
        finishedAt: null,
      },
      updatedAt: now,
    },
  }));
}

/**
 * Apply one adapter row result to the durable A1 journal. The frozen
 * validator is the gate: stale, malformed, wrong-target, or wrong-revision
 * results are never advanced.
 */
export function applyBulkPublicationRowResultToBatch(
  batch: BulkImportBatch,
  rowResult: BulkPublicationRowResult,
): BulkImportBatch {
  const row = batch.rows.find((candidate) => candidate.id === rowResult.rowId);
  if (!row || row.sourceGeneration !== rowResult.sourceGeneration) {
    throw new Error(
      `Refusing publication result for stale row ${rowResult.rowId} generation ${rowResult.sourceGeneration}.`,
    );
  }

  let nextBatch = batch;

  for (const stepResult of rowResult.steps) {
    if (
      stepResult.step !== 'audio' &&
      stepResult.step !== 'cover' &&
      stepResult.step !== 'metadata'
    ) {
      continue;
    }
    nextBatch = applyResourceStepResult(nextBatch, rowResult, stepResult);
  }

  return nextBatch;
}

function applyResourceStepResult(
  batch: BulkImportBatch,
  rowResult: BulkPublicationRowResult,
  result: BulkPublicationStepResult,
): BulkImportBatch {
  const resourceStep = result.step as BulkImportPublicationResourceIdentity['kind'];
  const row = batch.rows.find((candidate) => candidate.id === rowResult.rowId);
  if (!row || row.sourceGeneration !== rowResult.sourceGeneration) {
    throw new Error(
      `Refusing ${resourceStep.toUpperCase()} publication result for stale row ${rowResult.rowId}.`,
    );
  }

  const requiredContentRevision = getRequiredPublicationContentRevision(resourceStep, {
    sourceGeneration: row.sourceGeneration,
    source: row.localSource,
    metadata: row.metadata,
    cover: row.cover,
  });

  const validation = validateBulkPublicationStepResultAgainstCurrentRow(result, {
    batchId: rowResult.batchId,
    rowId: rowResult.rowId,
    sourceGeneration: rowResult.sourceGeneration,
    step: resourceStep,
    requiredContentRevision,
  });

  if (validation.classification !== 'current-valid') {
    throw new Error(
      `Refusing ${validation.classification} ${resourceStep.toUpperCase()} publication result: ${
        validation.reason ?? 'invalid result'
      }`,
    );
  }

  const journalKey = resourceStep;

  if (result.status === 'published') {
    const published = result as Extract<BulkPublicationStepResult, { status: 'published' }>;
    return replaceJournal(batch, row.id, (journal) => ({
      ...journal,
      [journalKey]: createPublishedPublicationStep({
        intent: published.intent,
        confirmed: published.reference,
        contentRevision: published.contentRevision,
        attemptId: published.attemptId,
        confirmedAt: published.confirmedAt,
        transactionSignature: published.transactionSignature,
      }),
    }));
  }

  if (result.status === 'failed') {
    const failed = result as Extract<BulkPublicationStepResult, { status: 'failed' }>;
    return replaceJournal(batch, row.id, (journal) => ({
      ...journal,
      [journalKey]: createFailedPublicationStep({
        intent: failed.intent,
        attempt: {
          attemptId: failed.attemptId,
          startedAt: null,
          finishedAt: null,
        },
        error: failed.error,
      }),
    }));
  }

  if (result.status === 'unknown') {
    const unknown = result as Extract<BulkPublicationStepResult, { status: 'unknown' }>;
    return replaceJournal(batch, row.id, (journal) => ({
      ...journal,
      [journalKey]: createUnknownPublicationStep({
        intent: unknown.intent,
        attemptId: unknown.attemptId,
        contentRevision: unknown.contentRevision,
        sourceGeneration: unknown.sourceGeneration,
        reference: null,
      }),
    }));
  }

  // Already-confirmed skips are intentionally no-ops: the current durable
  // evidence already satisfies the exact current audio revision.
  return batch;
}

/**
 * Derived per-row state for the A2 workspace. This is presentation-only and
 * does not change durable journal semantics.
 */
export function getHome2RowPublicationUiState(
  row: BulkImportRow,
  nativeSource: BulkPublicationSourceDescriptor | null,
  publishing: boolean,
): Home2RowPublicationUiState {
  const audioRevision = computeAudioContentRevision(row.localSource, row.sourceGeneration);

  if (publicationStepMatchesContent(row.publication.audio, 'audio', audioRevision)) {
    return 'audio-published';
  }

  const unknown = row.publication.audio;
  if (
    isUnknownPublicationStep(unknown) &&
    audioRevision !== null &&
    unknown.contentRevision === audioRevision
  ) {
    return 'unknown';
  }

  if (isFailedPublicationStep(row.publication.audio)) {
    return 'failed';
  }

  if (publishing) {
    return 'publishing';
  }

  if (
    nativeSource &&
    nativeSource.rowId === row.id &&
    nativeSource.sourceGeneration === row.sourceGeneration
  ) {
    return 'native-source-acquired';
  }

  if (row.audioSourceAvailable && row.localSource) {
    return 'native-source-required';
  }

  return 'staged';
}

export function isHome2AudioPublished(row: BulkImportRow): boolean {
  const audioRevision = computeAudioContentRevision(row.localSource, row.sourceGeneration);
  return publicationStepMatchesContent(row.publication.audio, 'audio', audioRevision);
}

export function isHome2AudioUnknown(row: BulkImportRow): boolean {
  const audioRevision = computeAudioContentRevision(row.localSource, row.sourceGeneration);
  const audio = row.publication.audio;
  return (
    isUnknownPublicationStep(audio) &&
    audioRevision !== null &&
    audio.contentRevision === audioRevision
  );
}

export function home2RowPublicationFailureMessage(row: BulkImportRow): string | null {
  if (!isFailedPublicationStep(row.publication.audio)) return null;
  return row.publication.audio.error?.message ?? 'AUDIO publication failed.';
}

export type Home2ResourcePublicationUiState =
  | 'not-required'
  | 'pending'
  | 'native-source-required'
  | 'native-source-acquired'
  | 'publishing'
  | 'published'
  | 'failed'
  | 'unknown';

function currentStep(
  row: BulkImportRow,
  kind: BulkImportPublicationResourceIdentity['kind'],
): BulkImportPublicationStep {
  return row.publication[kind];
}

function currentRevision(
  row: BulkImportRow,
  kind: BulkImportPublicationResourceIdentity['kind'],
): string | null {
  return getRequiredPublicationContentRevision(kind, {
    sourceGeneration: row.sourceGeneration,
    source: row.localSource,
    metadata: row.metadata,
    cover: row.cover,
  });
}

function isPublishedCurrent(
  row: BulkImportRow,
  kind: BulkImportPublicationResourceIdentity['kind'],
): boolean {
  return publicationStepMatchesContent(currentStep(row, kind), kind, currentRevision(row, kind));
}

function isUnknownCurrent(
  row: BulkImportRow,
  kind: BulkImportPublicationResourceIdentity['kind'],
): boolean {
  const step = currentStep(row, kind);
  const revision = currentRevision(row, kind);
  return isUnknownPublicationStep(step) && revision !== null && step.contentRevision === revision;
}

export function getHome2ResourcePublicationUiState(
  row: BulkImportRow,
  kind: BulkImportPublicationResourceIdentity['kind'],
  nativeSource: BulkPublicationSourceDescriptor | null,
  publishing: boolean,
): Home2ResourcePublicationUiState {
  if (kind === 'cover' && row.cover === null) {
    return 'not-required';
  }

  if (isPublishedCurrent(row, kind)) {
    return 'published';
  }

  if (isUnknownCurrent(row, kind)) {
    return 'unknown';
  }

  if (isFailedPublicationStep(currentStep(row, kind))) {
    return 'failed';
  }

  if (publishing) {
    return 'publishing';
  }

  if (
    nativeSource &&
    nativeSource.rowId === row.id &&
    nativeSource.sourceGeneration === row.sourceGeneration
  ) {
    return 'native-source-acquired';
  }

  if (kind === 'audio' && row.audioSourceAvailable && row.localSource) {
    return 'native-source-required';
  }

  if (kind === 'cover' && row.coverSourceAvailable) {
    return 'native-source-required';
  }

  if (kind === 'metadata') {
    return 'native-source-required';
  }

  return 'pending';
}

export function isHome2ResourcePublished(
  row: BulkImportRow,
  kind: BulkImportPublicationResourceIdentity['kind'],
): boolean {
  return isPublishedCurrent(row, kind);
}

export function isHome2ResourceUnknown(
  row: BulkImportRow,
  kind: BulkImportPublicationResourceIdentity['kind'],
): boolean {
  return isUnknownCurrent(row, kind);
}

export function home2ResourcePublicationFailureMessage(
  row: BulkImportRow,
  kind: BulkImportPublicationResourceIdentity['kind'],
): string | null {
  const step = currentStep(row, kind);
  if (!isFailedPublicationStep(step)) return null;
  return step.error?.message ?? `${kind.toUpperCase()} publication failed.`;
}

export function isHome2MetadataReadyToExport(row: BulkImportRow): boolean {
  if (!isPublishedCurrent(row, 'audio')) return false;

  const coverRevision = computeCoverContentRevision(row.cover);
  if (row.cover !== null) {
    return publicationStepMatchesContent(currentStep(row, 'cover'), 'cover', coverRevision);
  }

  return true;
}
