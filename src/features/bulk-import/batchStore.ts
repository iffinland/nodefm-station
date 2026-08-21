/* ============================================================
 * NodeFM Station — Bulk Import Batch Domain Store
 *
 * Pure, role-neutral staging operations. No QDN/Home logic and no
 * durable storage lives here. Browser File references are accepted
 * only as inputs and are never placed inside the batch itself.
 * ============================================================ */

import { generateId } from '../../utils/id';
import { parseArtistTitleFromFilename } from './filenameParser';
import {
  applyEmbeddedMetadataToMetadata,
  applyFilenameFallbackToMetadata,
  createEmptyBulkImportMetadata,
  createEmptyBulkImportProvenance,
  resetMetadataForSourceReplacement,
} from './metadataDraft';
import {
  createEmptyPublicationJournal as createEmptyJournal,
  invalidatePublicationForCoverChange,
  invalidatePublicationForMetadataChange,
  invalidatePublicationForSourceChange,
} from './publicationJournal';
import type {
  AppliedBulkImportExtraction,
  BulkImportBatch,
  BulkImportCoverDraft,
  BulkImportLocalSourceDescriptor,
  BulkImportMetadataField,
  BulkImportRole,
  BulkImportRow,
} from './types';

export type AddLocalStagingFilesResult = {
  batch: BulkImportBatch;
  added: Array<{ rowId: string; file: File }>;
};

export type ApplyExtractionResult = {
  batch: BulkImportBatch;
  usedCoverPreviewUrl: string | null;
};

export const createEmptyPublicationJournal = createEmptyJournal;

export function createBulkImportBatch(
  role: BulkImportRole,
  scope: string,
  options: { id?: string; createdAt?: string } = {},
): BulkImportBatch {
  const now = options.createdAt ?? new Date().toISOString();

  return {
    schemaVersion: 2,
    id: options.id?.trim() || generateId(),
    role,
    scope,
    createdAt: now,
    updatedAt: now,
    rows: [],
  };
}

export type CreateBulkImportRowInput = {
  id?: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  selected?: boolean;
};

export function createBulkImportRow(input: CreateBulkImportRowInput): BulkImportRow {
  const parsed = parseArtistTitleFromFilename(input.fileName);
  const merged = applyFilenameFallbackToMetadata(
    {
      metadata: createEmptyBulkImportMetadata(),
      provenance: createEmptyBulkImportProvenance(),
    },
    parsed,
  );

  return {
    id: input.id?.trim() || generateId(),
    selected: input.selected ?? true,
    localSource: {
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
    },
    sourceGeneration: 0,
    audioSourceAvailable: true,
    coverSourceAvailable: false,
    metadata: merged.metadata,
    manualFields: [],
    provenance: merged.provenance,
    durationMs: null,
    durationSource: 'none',
    cover: null,
    extraction: { status: 'idle' },
    publication: createEmptyJournal(),
  };
}

function touchBatch(batch: BulkImportBatch, now = new Date().toISOString()): BulkImportBatch {
  return { ...batch, updatedAt: now };
}

function replaceRow(
  batch: BulkImportBatch,
  rowId: string,
  update: (row: BulkImportRow) => BulkImportRow,
): BulkImportBatch {
  const index = batch.rows.findIndex((row) => row.id === rowId);
  if (index === -1) return batch;

  const rows = [...batch.rows];
  rows[index] = update(rows[index]);
  return touchBatch({ ...batch, rows });
}

export function getBulkImportRow(batch: BulkImportBatch, rowId: string): BulkImportRow | undefined {
  return batch.rows.find((row) => row.id === rowId);
}

/**
 * Add local browser Files as staging rows. The File objects are returned
 * alongside their row IDs for the caller to analyze in memory. They are
 * deliberately not stored on the batch.
 */
export function addLocalStagingFiles(
  batch: BulkImportBatch,
  files: readonly File[],
): AddLocalStagingFilesResult {
  const rows = [...batch.rows];
  const added: Array<{ rowId: string; file: File }> = [];

  for (const file of files) {
    const row = createBulkImportRow({
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    });
    rows.push(row);
    added.push({ rowId: row.id, file });
  }

  return {
    batch: touchBatch({ ...batch, rows }),
    added,
  };
}

export function setBulkImportRowSelected(
  batch: BulkImportBatch,
  rowId: string,
  selected: boolean,
): BulkImportBatch {
  return replaceRow(batch, rowId, (row) => ({ ...row, selected }));
}

export function removeBulkImportRow(batch: BulkImportBatch, rowId: string): BulkImportBatch {
  return touchBatch({
    ...batch,
    rows: batch.rows.filter((row) => row.id !== rowId),
  });
}

export function setBulkImportMetadataField(
  batch: BulkImportBatch,
  rowId: string,
  field: BulkImportMetadataField,
  value: string | string[],
): BulkImportBatch {
  return replaceRow(batch, rowId, (row) => {
    const metadata = { ...row.metadata };

    if (field === 'genres' || field === 'tags') {
      metadata[field] = Array.isArray(value) ? [...value] : [];
    } else {
      metadata[field] = typeof value === 'string' ? value : '';
    }

    return {
      ...row,
      metadata,
      provenance: { ...row.provenance, [field]: 'manual' as const },
      manualFields: row.manualFields.includes(field)
        ? row.manualFields
        : [...row.manualFields, field],
      publication: invalidatePublicationForMetadataChange(row.publication),
    };
  });
}

export function setBulkImportRowCover(
  batch: BulkImportBatch,
  rowId: string,
  cover: BulkImportCoverDraft | null,
): BulkImportBatch {
  return replaceRow(batch, rowId, (row) => ({
    ...row,
    cover,
    coverSourceAvailable: cover !== null,
    publication: invalidatePublicationForCoverChange(row.publication),
  }));
}

export function markBulkImportRowAnalyzing(batch: BulkImportBatch, rowId: string): BulkImportBatch {
  return replaceRow(batch, rowId, (row) => ({
    ...row,
    extraction: { status: 'running' },
  }));
}

function metadataDraftsEqual(
  left: BulkImportRow['metadata'],
  right: BulkImportRow['metadata'],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Apply a completed metadata/extraction result. Manual fields are
 * preserved; embedded values outrank earlier filename guesses. Changing
 * draft content invalidates the affected publication completion so a
 * stale "published" claim can never survive.
 */
export function applyBulkImportExtraction(
  batch: BulkImportBatch,
  rowId: string,
  extraction: AppliedBulkImportExtraction,
): ApplyExtractionResult {
  const row = batch.rows.find((candidate) => candidate.id === rowId);
  if (!row) {
    return { batch, usedCoverPreviewUrl: null };
  }

  const merged = applyEmbeddedMetadataToMetadata(
    { metadata: row.metadata, provenance: row.provenance },
    row.manualFields,
    extraction.metadata,
  );

  const hasValidDuration =
    extraction.durationMs !== null &&
    Number.isInteger(extraction.durationMs) &&
    extraction.durationMs > 0;

  const durationMs = hasValidDuration ? extraction.durationMs : row.durationMs;
  const durationSource = hasValidDuration
    ? extraction.durationSource === 'local'
      ? 'local'
      : 'embedded'
    : row.durationSource;

  let cover = row.cover;
  let usedCoverPreviewUrl: string | null = null;

  if (!cover && extraction.coverPreviewUrl) {
    const picture = extraction.metadata.picture;
    cover = {
      origin: 'embedded',
      fileName: picture?.fileName ?? null,
      mimeType: picture?.format ?? null,
      sizeBytes: picture?.data.length ?? null,
      previewUrl: extraction.coverPreviewUrl,
    };
    usedCoverPreviewUrl = extraction.coverPreviewUrl;
  }

  const metadataChanged = !metadataDraftsEqual(merged.metadata, row.metadata);
  const coverChanged = cover !== row.cover;

  let publication = row.publication;
  if (metadataChanged) {
    publication = invalidatePublicationForMetadataChange(publication);
  }
  if (coverChanged) {
    publication = invalidatePublicationForCoverChange(publication);
  }

  return {
    batch: replaceRow(batch, rowId, (current) => ({
      ...current,
      metadata: merged.metadata,
      provenance: merged.provenance,
      durationMs,
      durationSource,
      cover,
      coverSourceAvailable: cover !== null,
      extraction: { status: 'complete' },
      publication,
    })),
    usedCoverPreviewUrl,
  };
}

/**
 * Record a per-row extraction failure. When a safe local duration
 * fallback still succeeded, that duration can be preserved alongside
 * the truthful failure state.
 */
export function markBulkImportRowAnalysisFailed(
  batch: BulkImportBatch,
  rowId: string,
  error: string,
  durationMs?: number | null,
): BulkImportBatch {
  return replaceRow(batch, rowId, (row) => {
    const hasValidDuration =
      durationMs !== null &&
      durationMs !== undefined &&
      Number.isInteger(durationMs) &&
      durationMs > 0;

    return {
      ...row,
      durationMs: hasValidDuration ? durationMs : row.durationMs,
      durationSource: hasValidDuration ? 'local' : row.durationSource,
      extraction: { status: 'failed', error },
    };
  });
}

/**
 * Assign a new audio source to an existing row. This is used for both an
 * intentional replacement and a verified post-reload re-bind. Row identity
 * is retained while the source generation advances. Embedded metadata and
 * embedded covers from the previous source are dropped; manual edits and a
 * manual cover intent survive.
 */
export function setBulkImportRowSource(
  batch: BulkImportBatch,
  rowId: string,
  source: BulkImportLocalSourceDescriptor,
): BulkImportBatch {
  return replaceRow(batch, rowId, (row) => {
    const parsed = parseArtistTitleFromFilename(source.fileName);
    const merged = resetMetadataForSourceReplacement(
      { metadata: row.metadata, provenance: row.provenance },
      row.manualFields,
      parsed,
    );
    const coverCameFromAudio = row.cover?.origin === 'embedded';
    const cover = coverCameFromAudio ? null : row.cover;

    return {
      ...row,
      localSource: source,
      sourceGeneration: row.sourceGeneration + 1,
      audioSourceAvailable: true,
      coverSourceAvailable: cover !== null && row.coverSourceAvailable,
      metadata: merged.metadata,
      provenance: merged.provenance,
      durationMs: null,
      durationSource: 'none',
      cover,
      extraction: { status: 'idle' },
      publication: invalidatePublicationForSourceChange(row.publication, coverCameFromAudio),
    };
  });
}
