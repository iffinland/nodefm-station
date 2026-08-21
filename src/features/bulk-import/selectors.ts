/* ============================================================
 * NodeFM Station — Bulk Import Selectors
 *
 * Derived validation and summary state for a staging batch. UI
 * components consume these selectors instead of duplicating limit
 * or completeness calculations.
 * ============================================================ */

import { isValidReleaseDateValue } from '../metadata-intelligence/releaseDate';
import { isValidDurationMs } from '../../utils/duration';
import {
  computeAudioContentRevision,
  computeCoverContentRevision,
  computeMetadataContentRevision,
} from './contentRevision';
import { getBulkImportLimits, type BulkImportLimits } from './limits';
import {
  isFailedPublicationStep,
  isPublishedPublicationStep,
  isUnknownPublicationStep,
  publicationStepStatus,
} from './publicationJournal';
import type {
  BulkImportBatch,
  BulkImportMetadataField,
  BulkImportRow,
  BulkImportPublicationResourceIdentity,
  BulkImportPublicationStep,
} from './types';

export type BulkImportRowValidation = {
  missingRequiredFields: BulkImportMetadataField[];
  hasInvalidReleaseDate: boolean;
  sourceMissing: boolean;
  durationMissing: boolean;
  coverSourceMissing: boolean;
  extractionFailed: boolean;
  needsAttention: boolean;
};

export function getBulkImportRowValidation(row: BulkImportRow): BulkImportRowValidation {
  const missingRequiredFields: BulkImportMetadataField[] = [];

  if (!row.metadata.artist.trim()) missingRequiredFields.push('artist');
  if (!row.metadata.title.trim()) missingRequiredFields.push('title');

  const releaseDate = row.metadata.releaseDate.trim();
  const hasInvalidReleaseDate = releaseDate.length > 0 && !isValidReleaseDateValue(releaseDate);
  const sourceMissing = !row.audioSourceAvailable || !row.localSource;
  const durationMissing = !isValidDurationMs(row.durationMs);
  const coverSourceMissing = row.cover !== null && !row.coverSourceAvailable;
  const extractionFailed = row.extraction.status === 'failed';

  return {
    missingRequiredFields,
    hasInvalidReleaseDate,
    sourceMissing,
    durationMissing,
    coverSourceMissing,
    extractionFailed,
    needsAttention:
      missingRequiredFields.length > 0 ||
      hasInvalidReleaseDate ||
      sourceMissing ||
      durationMissing ||
      coverSourceMissing ||
      extractionFailed,
  };
}

export type BulkImportRowDisplayStatus =
  'analyzing' | 'source-missing' | 'needs-attention' | 'ready';

export function getBulkImportRowDisplayStatus(row: BulkImportRow): BulkImportRowDisplayStatus {
  if (row.extraction.status === 'running') {
    return 'analyzing';
  }

  const validation = getBulkImportRowValidation(row);

  if (validation.sourceMissing) {
    return 'source-missing';
  }

  if (validation.needsAttention) {
    return 'needs-attention';
  }

  return 'ready';
}

export type BulkImportPublicationStatus =
  'not-started' | 'partial' | 'complete' | 'failed' | 'unknown';

/**
 * Reduce a row's journal to one honest overall status. This is row-aware:
 * a `published` step is counted only when its durable evidence matches
 * the current audio/cover/metadata content revision. Unknown is
 * deliberately distinct from confirmed failure and from complete.
 */
export function getBulkImportPublicationStatus(row: BulkImportRow): BulkImportPublicationStatus {
  const journal = row.publication;
  const source = journal.source.status;

  const audioRevision = computeAudioContentRevision(row.localSource, row.sourceGeneration);
  const coverRevision = computeCoverContentRevision(row.cover);
  const metadataRevision = computeMetadataContentRevision(row.metadata);

  const hasNotStartedOnly =
    publicationStepStatus(journal.audio) === 'not-started' &&
    publicationStepStatus(journal.cover) === 'not-started' &&
    publicationStepStatus(journal.metadata) === 'not-started';

  if (source === 'not-started' && hasNotStartedOnly) {
    return 'not-started';
  }

  const audioComplete = stepMatchesCurrentContent(journal.audio, 'audio', audioRevision);
  const coverRequired = row.cover !== null;
  const coverComplete =
    !coverRequired || stepMatchesCurrentContent(journal.cover, 'cover', coverRevision);
  const metadataComplete = stepMatchesCurrentContent(
    journal.metadata,
    'metadata',
    metadataRevision,
  );

  if (
    audioComplete &&
    metadataComplete &&
    (coverRequired ? coverComplete : publicationStepStatus(journal.cover) === 'not-started')
  ) {
    return 'complete';
  }

  if (
    source === 'unknown' ||
    isUnknownPublicationStep(journal.audio) ||
    isUnknownPublicationStep(journal.cover) ||
    isUnknownPublicationStep(journal.metadata)
  ) {
    return 'unknown';
  }

  if (
    isFailedPublicationStep(journal.audio) ||
    isFailedPublicationStep(journal.cover) ||
    isFailedPublicationStep(journal.metadata)
  ) {
    return 'failed';
  }

  return 'partial';
}

function stepMatchesCurrentContent(
  step: BulkImportPublicationStep,
  kind: BulkImportPublicationResourceIdentity['kind'],
  revision: string | null,
): boolean {
  return (
    isPublishedPublicationStep(step) &&
    step.intent.kind === kind &&
    step.contentRevision === revision
  );
}

export type BulkImportBatchSummary = {
  limits: BulkImportLimits;
  validRows: number;
  rowsNeedingAttention: number;
  selectedRowsNeedingAttention: number;
  publicationBlockers: string[];
  isPublicationReady: boolean;
};

export function getBulkImportBatchSummary(batch: BulkImportBatch): BulkImportBatchSummary {
  const limits = getBulkImportLimits(batch.rows);
  let validRows = 0;
  let rowsNeedingAttention = 0;
  let selectedRowsNeedingAttention = 0;
  let missingRequiredSelected = 0;
  let invalidReleaseSelected = 0;
  let sourceMissingSelected = 0;
  let durationMissingSelected = 0;
  let coverSourceMissingSelected = 0;

  for (const row of batch.rows) {
    const validation = getBulkImportRowValidation(row);

    if (validation.needsAttention) {
      rowsNeedingAttention += 1;
    } else {
      validRows += 1;
    }

    if (!row.selected) continue;

    if (validation.needsAttention) selectedRowsNeedingAttention += 1;
    if (validation.missingRequiredFields.length > 0) missingRequiredSelected += 1;
    if (validation.hasInvalidReleaseDate) invalidReleaseSelected += 1;
    if (validation.sourceMissing) sourceMissingSelected += 1;
    if (validation.durationMissing) durationMissingSelected += 1;
    if (validation.coverSourceMissing) coverSourceMissingSelected += 1;
  }

  const publicationBlockers: string[] = [];

  if (limits.selectedCount === 0) {
    publicationBlockers.push('Select at least one track to publish.');
  }

  if (limits.exceedsTrackLimit) {
    publicationBlockers.push('Selected tracks exceed the 15 track limit.');
  }

  if (limits.exceedsSizeLimit) {
    publicationBlockers.push('Selected audio exceeds the 100 MiB limit.');
  }

  if (missingRequiredSelected > 0) {
    publicationBlockers.push(
      `${missingRequiredSelected} selected track${missingRequiredSelected === 1 ? '' : 's'} missing Artist or Title.`,
    );
  }

  if (invalidReleaseSelected > 0) {
    publicationBlockers.push(
      `${invalidReleaseSelected} selected track${invalidReleaseSelected === 1 ? '' : 's'} ${
        invalidReleaseSelected === 1 ? 'has' : 'have'
      } an invalid release date.`,
    );
  }

  if (sourceMissingSelected > 0) {
    publicationBlockers.push(
      `${sourceMissingSelected} selected track${sourceMissingSelected === 1 ? '' : 's'} ${
        sourceMissingSelected === 1 ? 'needs' : 'need'
      } their audio file re-selected.`,
    );
  }

  if (durationMissingSelected > 0) {
    publicationBlockers.push(
      `${durationMissingSelected} selected track${durationMissingSelected === 1 ? '' : 's'} missing a valid duration.`,
    );
  }

  if (coverSourceMissingSelected > 0) {
    publicationBlockers.push(
      `${coverSourceMissingSelected} selected track${coverSourceMissingSelected === 1 ? '' : 's'} ${
        coverSourceMissingSelected === 1 ? 'has' : 'have'
      } a cover that needs re-selection or removal.`,
    );
  }

  return {
    limits,
    validRows,
    rowsNeedingAttention,
    selectedRowsNeedingAttention,
    publicationBlockers,
    isPublicationReady: publicationBlockers.length === 0,
  };
}
