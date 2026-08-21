/* ============================================================
 * NodeFM Station — Bulk Import Session Storage
 *
 * Session-scoped durable draft storage. Serialization uses an
 * explicit allowlisted DTO rather than spreading live domain objects,
 * so a future native handle or adapter scratch field cannot be
 * persisted accidentally. Raw File/Blob objects, object URLs, source
 * tokens, and transient handles are never written.
 * ============================================================ */

import { isRecord } from '../../../utils/record';
import {
  BULK_IMPORT_PUBLICATION_JOURNAL_SCHEMA_VERSION,
  createEmptyPublicationJournal,
  createEmptyPublicationStep,
  createFailedPublicationStep,
  publicationStepHasError,
} from '../publicationJournal';
import type {
  BulkImportBatch,
  BulkImportCoverDraft,
  BulkImportCoverOrigin,
  BulkImportDurationSource,
  BulkImportLocalSourceDescriptor,
  BulkImportMetadataDraft,
  BulkImportMetadataField,
  BulkImportMetadataProvenance,
  BulkImportMetadataProvenanceSource,
  BulkImportPublicationAttempt,
  BulkImportPublicationError,
  BulkImportPublicationJournal,
  BulkImportPublicationReference,
  BulkImportPublicationResourceIdentity,
  BulkImportPublicationSource,
  BulkImportPublicationSourceStatus,
  BulkImportPublicationStep,
  BulkImportRole,
  BulkImportRow,
} from '../types';

const STORAGE_PREFIX = 'nodefm-bulk-import:';
const CURRENT_SCHEMA_VERSION = 2;

const METADATA_FIELDS = new Set<BulkImportMetadataField>([
  'artist',
  'title',
  'album',
  'releaseDate',
  'genres',
  'tags',
]);
const PROVENANCE_SOURCES = new Set<BulkImportMetadataProvenanceSource>([
  'none',
  'embedded',
  'filename',
  'manual',
]);
const DURATION_SOURCES = new Set<BulkImportDurationSource>(['none', 'embedded', 'local']);
const COVER_ORIGINS = new Set<BulkImportCoverOrigin>(['embedded', 'manual']);
const LEGACY_STEP_STATUSES = new Set([
  'not-started',
  'in-progress',
  'published',
  'failed',
  'unknown',
]);
const SOURCE_STATUSES = new Set<BulkImportPublicationSourceStatus>([
  'not-started',
  'acquired',
  'unknown',
]);
const PUBLICATION_KINDS = new Set(['audio', 'cover', 'metadata']);

type DurableCoverDraft = {
  origin: BulkImportCoverOrigin;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
};

type DurableRow = {
  id: string;
  selected: boolean;
  localSource: BulkImportLocalSourceDescriptor | null;
  sourceGeneration: number;
  metadata: BulkImportMetadataDraft;
  manualFields: BulkImportMetadataField[];
  provenance: BulkImportMetadataProvenance;
  durationMs: number | null;
  durationSource: BulkImportDurationSource;
  cover: DurableCoverDraft | null;
  publication: BulkImportPublicationJournal;
};

type DurableBatch = {
  schemaVersion: 2;
  id: string;
  role: BulkImportRole;
  scope: string;
  createdAt: string;
  updatedAt: string;
  rows: DurableRow[];
};

function storageKey(role: BulkImportRole, scope: string): string {
  return `${STORAGE_PREFIX}${role}:${scope}`;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function asNullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : asString(value);
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asInteger(value: unknown): number {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0
    ? value
    : 0;
}

function asSourceGeneration(value: unknown): number | null {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0
    ? value
    : null;
}

// ── Durable DTO Construction (allowlist only) ──────────────────────

function toDurableCover(cover: BulkImportCoverDraft | null): DurableCoverDraft | null {
  if (!cover) return null;

  return {
    origin: cover.origin,
    fileName: cover.fileName,
    mimeType: cover.mimeType,
    sizeBytes: cover.sizeBytes,
  };
}

function toDurableRow(row: BulkImportRow): DurableRow {
  return {
    id: row.id,
    selected: row.selected,
    localSource: row.localSource
      ? {
          fileName: row.localSource.fileName,
          mimeType: row.localSource.mimeType,
          sizeBytes: row.localSource.sizeBytes,
        }
      : null,
    sourceGeneration: row.sourceGeneration,
    metadata: {
      artist: row.metadata.artist,
      title: row.metadata.title,
      album: row.metadata.album,
      releaseDate: row.metadata.releaseDate,
      genres: [...row.metadata.genres],
      tags: [...row.metadata.tags],
    },
    manualFields: [...row.manualFields],
    provenance: {
      artist: row.provenance.artist,
      title: row.provenance.title,
      album: row.provenance.album,
      releaseDate: row.provenance.releaseDate,
      genres: row.provenance.genres,
      tags: row.provenance.tags,
    },
    durationMs: row.durationMs,
    durationSource: row.durationSource,
    cover: toDurableCover(row.cover),
    publication: row.publication,
  };
}

function toDurableBatch(batch: BulkImportBatch): DurableBatch {
  return {
    schemaVersion: 2,
    id: batch.id,
    role: batch.role,
    scope: batch.scope,
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
    rows: batch.rows.map(toDurableRow),
  };
}

// ── Durable DTO Sanitization (read path) ───────────────────────────

function sanitizeMetadata(raw: unknown): BulkImportMetadataDraft | null {
  if (!isRecord(raw)) return null;

  return {
    artist: asString(raw.artist),
    title: asString(raw.title),
    album: asString(raw.album),
    releaseDate: asString(raw.releaseDate),
    genres: asStringArray(raw.genres),
    tags: asStringArray(raw.tags),
  };
}

function sanitizeProvenance(raw: unknown): BulkImportMetadataProvenance | null {
  if (!isRecord(raw)) return null;

  const result: Partial<BulkImportMetadataProvenance> = {};

  for (const field of METADATA_FIELDS) {
    const value = asString(raw[field]);
    if (!PROVENANCE_SOURCES.has(value as BulkImportMetadataProvenanceSource)) return null;
    result[field] = value as BulkImportMetadataProvenanceSource;
  }

  return result as BulkImportMetadataProvenance;
}

function sanitizeLocalSource(raw: unknown): BulkImportLocalSourceDescriptor | null {
  if (!isRecord(raw)) return null;

  const fileName = asString(raw.fileName);
  const sizeBytes =
    typeof raw.sizeBytes === 'number' && Number.isFinite(raw.sizeBytes) && raw.sizeBytes >= 0
      ? raw.sizeBytes
      : 0;

  if (!fileName || sizeBytes < 0) return null;

  return {
    fileName,
    mimeType: asString(raw.mimeType),
    sizeBytes,
  };
}

function sanitizeDurationSource(raw: unknown): BulkImportDurationSource | null {
  const value = asString(raw);
  return DURATION_SOURCES.has(value as BulkImportDurationSource)
    ? (value as BulkImportDurationSource)
    : null;
}

function sanitizeDurationMs(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) && Number.isInteger(raw) && raw > 0
    ? raw
    : null;
}

function sanitizeDurableCover(raw: unknown): DurableCoverDraft | null {
  if (!isRecord(raw)) return null;

  const origin = asString(raw.origin);
  if (!COVER_ORIGINS.has(origin as BulkImportCoverOrigin)) return null;

  return {
    origin: origin as BulkImportCoverOrigin,
    fileName: asNullableString(raw.fileName),
    mimeType: asNullableString(raw.mimeType),
    sizeBytes: asNullableNumber(raw.sizeBytes),
  };
}

function sanitizeAttempt(raw: unknown): BulkImportPublicationAttempt | null {
  if (!isRecord(raw)) return null;

  return {
    attemptId: asString(raw.attemptId),
    startedAt: asNullableString(raw.startedAt),
    finishedAt: asNullableString(raw.finishedAt),
  };
}

function sanitizeError(raw: unknown): BulkImportPublicationError | null {
  if (!isRecord(raw)) return null;

  return {
    code: asString(raw.code),
    message: asString(raw.message),
    retryable: raw.retryable === true,
  };
}

function sanitizeReference(raw: unknown): BulkImportPublicationReference | null {
  if (!isRecord(raw)) return null;

  const service = asString(raw.service);
  const name = asString(raw.name);
  if (!service || !name) return null;

  return {
    service,
    name,
    identifier: typeof raw.identifier === 'string' ? raw.identifier : undefined,
  };
}

function sanitizeResourceIdentity(raw: unknown): BulkImportPublicationResourceIdentity | null {
  if (!isRecord(raw)) return null;

  const kind = asString(raw.kind);
  if (!PUBLICATION_KINDS.has(kind)) return null;

  return {
    kind: kind as BulkImportPublicationResourceIdentity['kind'],
    service: asString(raw.service),
    name: asNullableString(raw.name),
    identifier: asNullableString(raw.identifier),
  };
}

function sanitizeSource(raw: unknown): BulkImportPublicationSource | null {
  if (!isRecord(raw)) return null;

  const status = asString(raw.status);
  if (!SOURCE_STATUSES.has(status as BulkImportPublicationSourceStatus)) return null;

  return {
    status: status as BulkImportPublicationSourceStatus,
    attempt: raw.attempt == null ? null : sanitizeAttempt(raw.attempt),
    updatedAt: asNullableString(raw.updatedAt),
  };
}

/**
 * Durable journal sanitization policy:
 *
 * A step is never repaired into trusted completion. Published evidence is
 * accepted only when it is structurally complete and its resource kind
 * matches the journal key being sanitized. Any contradictory state such as
 * an active error on a `published` record, a wrong resource kind, or missing
 * attempt/revision/confirmation evidence is safely downgraded to
 * `not-started`. Unknown attempts are preserved only when they retain enough
 * identity to reconcile the exact original revision and source generation.
 */
function sanitizeStep(
  raw: unknown,
  expectedKind: BulkImportPublicationResourceIdentity['kind'],
): BulkImportPublicationStep | null {
  if (!isRecord(raw)) return null;

  const status = asString(raw.status);
  const updatedAt = asNullableString(raw.updatedAt);

  if (status === 'not-started') {
    return { status: 'not-started', updatedAt };
  }

  if (status === 'in-progress') {
    const intent = sanitizeResourceIdentity(raw.intent);
    const attempt = sanitizeAttempt(raw.attempt);
    if (!intent || intent.kind !== expectedKind || !attempt || !attempt.attemptId.trim()) {
      return createEmptyPublicationStep();
    }

    return {
      status: 'in-progress',
      intent,
      attempt,
      updatedAt,
    };
  }

  if (status === 'failed') {
    const intent = raw.intent == null ? null : sanitizeResourceIdentity(raw.intent);
    if (intent && intent.kind !== expectedKind) {
      return createEmptyPublicationStep();
    }

    return {
      status: 'failed',
      intent,
      attempt: raw.attempt == null ? null : sanitizeAttempt(raw.attempt),
      error: raw.error == null ? null : sanitizeError(raw.error),
      updatedAt,
    };
  }

  if (status === 'unknown') {
    const attempt = sanitizeAttempt(raw.attempt);
    const intent = sanitizeResourceIdentity(raw.intent);
    const contentRevision = asNullableString(raw.contentRevision);
    const sourceGeneration = asSourceGeneration(raw.sourceGeneration);
    const reference = raw.reference == null ? null : sanitizeReference(raw.reference);

    if (
      !attempt ||
      !attempt.attemptId.trim() ||
      !intent ||
      intent.kind !== expectedKind ||
      !contentRevision ||
      sourceGeneration === null
    ) {
      return createEmptyPublicationStep();
    }

    return {
      status: 'unknown',
      intent,
      attempt,
      contentRevision,
      sourceGeneration,
      reference,
      updatedAt,
    };
  }

  if (status === 'published') {
    const activeError = raw.error == null ? null : sanitizeError(raw.error);
    if (activeError && publicationStepHasError(activeError)) {
      return createEmptyPublicationStep();
    }

    const intent = sanitizeResourceIdentity(raw.intent);
    const confirmed = sanitizeReference(raw.confirmed);
    const attempt = sanitizeAttempt(raw.attempt);
    const contentRevision = asNullableString(raw.contentRevision);
    const confirmedAt = asNullableString(raw.confirmedAt);

    if (
      !intent ||
      intent.kind !== expectedKind ||
      !confirmed ||
      !attempt ||
      !attempt.attemptId.trim() ||
      !contentRevision ||
      !confirmedAt
    ) {
      return createEmptyPublicationStep();
    }

    return {
      status: 'published',
      intent,
      confirmed,
      contentRevision,
      attempt,
      transactionSignature: asNullableString(raw.transactionSignature),
      confirmedAt,
      updatedAt,
    };
  }

  return null;
}

function sanitizeJournal(raw: unknown): BulkImportPublicationJournal | null {
  if (!isRecord(raw)) return null;

  const source = sanitizeSource(raw.source);
  const audio = sanitizeStep(raw.audio, 'audio');
  const cover = sanitizeStep(raw.cover, 'cover');
  const metadata = sanitizeStep(raw.metadata, 'metadata');

  if (!source || !audio || !cover || !metadata) return null;

  return {
    schemaVersion: BULK_IMPORT_PUBLICATION_JOURNAL_SCHEMA_VERSION,
    source,
    audio,
    cover,
    metadata,
  };
}

function sanitizeDurableRow(raw: unknown): DurableRow | null {
  if (!isRecord(raw)) return null;
  if (!isNonEmptyString(raw.id)) return null;

  const metadata = sanitizeMetadata(raw.metadata);
  const provenance = sanitizeProvenance(raw.provenance);
  const journal = sanitizeJournal(raw.publication);
  if (!metadata || !provenance || !journal) return null;

  const manualFields = asStringArray(raw.manualFields).filter(
    (field): field is BulkImportMetadataField =>
      METADATA_FIELDS.has(field as BulkImportMetadataField),
  );

  const localSource = raw.localSource == null ? null : sanitizeLocalSource(raw.localSource);
  if (raw.localSource != null && !localSource) return null;

  const durationSource = sanitizeDurationSource(raw.durationSource);
  if (!durationSource) return null;

  const cover = raw.cover == null ? null : sanitizeDurableCover(raw.cover);
  if (raw.cover != null && !cover) return null;

  return {
    id: raw.id,
    selected: raw.selected === true,
    localSource,
    sourceGeneration: asInteger(raw.sourceGeneration),
    metadata,
    manualFields,
    provenance,
    durationMs: sanitizeDurationMs(raw.durationMs),
    durationSource,
    cover,
    publication: journal,
  };
}

function sanitizeDurableBatch(raw: unknown): DurableBatch | null {
  if (!isRecord(raw)) return null;
  if (raw.schemaVersion !== CURRENT_SCHEMA_VERSION) return null;
  if (!isNonEmptyString(raw.id)) return null;
  if (raw.role !== 'admin' && raw.role !== 'listener') return null;
  if (!Array.isArray(raw.rows)) return null;

  const rows: DurableRow[] = [];
  for (const rawRow of raw.rows) {
    const row = sanitizeDurableRow(rawRow);
    if (!row) return null;
    rows.push(row);
  }

  return {
    schemaVersion: 2,
    id: raw.id,
    role: raw.role,
    scope: asString(raw.scope),
    createdAt: asString(raw.createdAt) || new Date().toISOString(),
    updatedAt: asString(raw.updatedAt) || new Date().toISOString(),
    rows,
  };
}

// ── Legacy V1 Migration ────────────────────────────────────────────

function migrateLegacyJournal(raw: unknown): BulkImportPublicationJournal | null {
  if (!isRecord(raw)) return null;

  const sourceStatus = asString(raw.source);
  if (!SOURCE_STATUSES.has(sourceStatus as BulkImportPublicationSourceStatus)) return null;

  const journal = createEmptyPublicationJournal();
  journal.source.status = sourceStatus as BulkImportPublicationSourceStatus;

  for (const key of ['audio', 'cover', 'metadata'] as const) {
    const value = asString(raw[key]);
    if (!LEGACY_STEP_STATUSES.has(value)) return null;
    journal[key] = migrateLegacyStepStatus(value);
  }

  return journal;
}

function migrateLegacyStepStatus(raw: string): BulkImportPublicationStep {
  if (raw === 'failed') {
    return createFailedPublicationStep({
      error: {
        code: 'LEGACY_V1_UNVERIFIED',
        message: 'Legacy publication failure is unverified.',
        retryable: false,
      },
    });
  }

  // Legacy v1 bare labels contain no durable evidence. In particular,
  // `published`, `unknown`, and `in-progress` are downgraded to
  // not-started rather than trusted as evidence-bearing v2 completion.
  return createEmptyPublicationStep();
}

function migrateLegacyRow(raw: unknown): DurableRow | null {
  if (!isRecord(raw) || !isNonEmptyString(raw.id)) return null;

  const metadata = sanitizeMetadata(raw.metadata);
  const provenance = sanitizeProvenance(raw.provenance);
  const journal = migrateLegacyJournal(raw.publication);
  if (!metadata || !provenance || !journal) return null;

  const manualFields = asStringArray(raw.manualFields).filter(
    (field): field is BulkImportMetadataField =>
      METADATA_FIELDS.has(field as BulkImportMetadataField),
  );
  const localSource = raw.localSource == null ? null : sanitizeLocalSource(raw.localSource);
  const cover =
    raw.cover == null
      ? null
      : sanitizeDurableCover({ ...(isRecord(raw.cover) ? raw.cover : {}), previewUrl: null });
  const durationSource = sanitizeDurationSource(raw.durationSource) ?? 'none';

  return {
    id: raw.id,
    selected: raw.selected === true,
    localSource,
    sourceGeneration: 0,
    metadata,
    manualFields,
    provenance,
    durationMs: sanitizeDurationMs(raw.durationMs),
    durationSource,
    cover,
    publication: journal,
  };
}

function migrateLegacyBatch(raw: unknown): DurableBatch | null {
  if (!isRecord(raw) || raw.schemaVersion !== 1) return null;
  if (!isNonEmptyString(raw.id) || !Array.isArray(raw.rows)) return null;
  if (raw.role !== 'admin' && raw.role !== 'listener') return null;

  const rows: DurableRow[] = [];
  for (const rawRow of raw.rows) {
    const row = migrateLegacyRow(rawRow);
    if (!row) return null;
    rows.push(row);
  }

  return {
    schemaVersion: 2,
    id: raw.id,
    role: raw.role,
    scope: asString(raw.scope),
    createdAt: asString(raw.createdAt) || new Date().toISOString(),
    updatedAt: asString(raw.updatedAt) || new Date().toISOString(),
    rows,
  };
}

// ── Live Batch Reconstruction ──────────────────────────────────────

function toLiveBatch(
  durable: DurableBatch,
  expectedRole: BulkImportRole,
  expectedScope: string,
): BulkImportBatch {
  return {
    schemaVersion: 2,
    id: durable.id,
    role: expectedRole,
    scope: expectedScope,
    createdAt: durable.createdAt,
    updatedAt: durable.updatedAt,
    rows: durable.rows.map((row) => {
      const source = row.publication.source;
      const normalizedSource =
        source.status === 'acquired' ? { ...source, status: 'not-started' as const } : source;

      return {
        id: row.id,
        selected: row.selected,
        localSource: row.localSource,
        sourceGeneration: row.sourceGeneration,
        audioSourceAvailable: false,
        coverSourceAvailable: false,
        metadata: row.metadata,
        manualFields: row.manualFields,
        provenance: row.provenance,
        durationMs: row.durationMs,
        durationSource: row.durationSource,
        cover: row.cover ? { ...row.cover, previewUrl: null } : null,
        extraction: { status: 'idle' as const },
        publication: {
          ...row.publication,
          source: normalizedSource,
        },
      };
    }),
  };
}

// ── Public API ─────────────────────────────────────────────────────

export function serializeBulkImportBatch(batch: BulkImportBatch): string {
  return JSON.stringify(toDurableBatch(batch));
}

export function deserializeBulkImportBatch(
  raw: string,
  expectedRole: BulkImportRole,
  expectedScope: string,
): BulkImportBatch | null {
  let value: unknown;

  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(value)) return null;

  const durable =
    value.schemaVersion === 1 ? migrateLegacyBatch(value) : sanitizeDurableBatch(value);

  if (!durable) return null;
  if (durable.role !== expectedRole || durable.scope !== expectedScope) return null;

  return toLiveBatch(durable, expectedRole, expectedScope);
}

export function loadBulkImportBatch(role: BulkImportRole, scope: string): BulkImportBatch | null {
  if (typeof window === 'undefined' || !scope.trim()) return null;

  try {
    const raw = window.sessionStorage.getItem(storageKey(role, scope));
    if (!raw) return null;
    return deserializeBulkImportBatch(raw, role, scope);
  } catch {
    return null;
  }
}

export function saveBulkImportBatch(batch: BulkImportBatch): boolean {
  if (typeof window === 'undefined' || !batch.scope.trim()) return false;

  try {
    window.sessionStorage.setItem(
      storageKey(batch.role, batch.scope),
      serializeBulkImportBatch(batch),
    );
    return true;
  } catch {
    return false;
  }
}

export function clearBulkImportBatch(role: BulkImportRole, scope: string): void {
  if (typeof window === 'undefined' || !scope.trim()) return;

  try {
    window.sessionStorage.removeItem(storageKey(role, scope));
  } catch {
    // Session storage is best-effort only.
  }
}
