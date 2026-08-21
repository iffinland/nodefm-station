/* ============================================================
 * NodeFM Station — Bulk Import Domain Types
 *
 * Role-neutral staging types shared by Admin and Listener Bulk
 * Import. These types intentionally contain no QDN/Home transport
 * details.
 *
 * Durable domain values (metadata, provenance, source descriptor,
 * publication journal) contain no browser File/Blob, object URL,
 * native source handle, or platform acquisition token. Those values
 * live only in the in-memory transient registry.
 * ============================================================ */

export type BulkImportRole = 'admin' | 'listener';

export type BulkImportMetadataField =
  'artist' | 'title' | 'album' | 'releaseDate' | 'genres' | 'tags';

export type BulkImportMetadataDraft = {
  artist: string;
  title: string;
  album: string;
  releaseDate: string;
  genres: string[];
  tags: string[];
};

export type BulkImportMetadataProvenanceSource = 'none' | 'embedded' | 'filename' | 'manual';

export type BulkImportMetadataProvenance = Record<
  BulkImportMetadataField,
  BulkImportMetadataProvenanceSource
>;

export type BulkImportDurationSource = 'none' | 'embedded' | 'local';

export type BulkImportLocalSourceDescriptor = {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

export type BulkImportCoverOrigin = 'embedded' | 'manual';

/**
 * A cover preview is deliberately transient. `previewUrl` is a browser
 * object URL held in memory only and is stripped before any durable write.
 * `coverSourceAvailable` on the row, not this draft, records whether the
 * underlying Blob/File is still present in the current session.
 */
export type BulkImportCoverDraft = {
  origin: BulkImportCoverOrigin;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  previewUrl: string | null;
};

export type BulkImportExtractionStatus = 'idle' | 'running' | 'complete' | 'failed';

export type BulkImportExtractionState = {
  status: BulkImportExtractionStatus;
  error?: string;
};

// ── Publication Journal V2 ─────────────────────────────────────────
//
// Every publication step is a versioned record rather than a bare
// string. Steps carry the intended resource identity, confirmed
// reference evidence, the exact content revision they prove, an
// attempt/reconciliation identity, and a classified error when one
// exists. This is transport-neutral and contains no Home action names.

export type BulkImportPublicationSourceStatus = 'not-started' | 'acquired' | 'unknown';

export type BulkImportPublicationResourceKind = 'audio' | 'cover' | 'metadata';

/**
 * The resource this step intends to publish. Identifiers may be null
 * before the platform assigns or confirms them.
 */
export type BulkImportPublicationResourceIdentity = {
  kind: BulkImportPublicationResourceKind;
  service: string;
  name: string | null;
  identifier: string | null;
};

/**
 * A confirmed QDN resource reference. Mirrors the shared QdnResourceRef
 * shape without importing unrelated domain modules into staging.
 */
export type BulkImportPublicationReference = {
  service: string;
  name: string;
  identifier?: string;
};

export type BulkImportPublicationError = {
  code: string;
  message: string;
  retryable: boolean;
};

export type BulkImportPublicationAttempt = {
  attemptId: string;
  startedAt: string | null;
  finishedAt: string | null;
};

/**
 * Discriminated publication steps. The previous permissive single-object
 * shape made `status: 'published'` coexist with null evidence. Those
 * combinations are now unrepresentable.
 *
 * `published` is the only variant that can prove content was confirmed. It
 * requires the intended resource identity, the confirmed reference, the
 * exact content revision it represents, the attempt/confirmation that
 * produced it, and a confirmation timestamp. A transaction signature is
 * optional because the platform-neutral contract does not guarantee one.
 */
export type BulkImportPublicationNotStartedStep = {
  status: 'not-started';
  updatedAt: string | null;
};

export type BulkImportPublicationInProgressStep = {
  status: 'in-progress';
  intent: BulkImportPublicationResourceIdentity;
  attempt: BulkImportPublicationAttempt;
  updatedAt: string | null;
};

export type BulkImportPublicationFailedStep = {
  status: 'failed';
  intent: BulkImportPublicationResourceIdentity | null;
  attempt: BulkImportPublicationAttempt | null;
  error: BulkImportPublicationError | null;
  updatedAt: string | null;
};

export type BulkImportPublicationUnknownStep = {
  status: 'unknown';
  intent: BulkImportPublicationResourceIdentity;
  attempt: BulkImportPublicationAttempt;
  /**
   * Exact intended content revision for this attempt. This is the local
   * authority used later to bind reconciliation to the original content.
   */
  contentRevision: string;
  /**
   * Source generation this attempt belongs to. It is persisted with the
   * unknown journal step so reconciliation cannot be applied to a newer
   * source assignment after reload or adapter recreation.
   */
  sourceGeneration: number;
  /**
   * Optional durable platform evidence needed to perform future
   * reconciliation. Transient native handles must never be placed here.
   */
  reference: BulkImportPublicationReference | null;
  updatedAt: string | null;
};

export type BulkImportPublicationPublishedStep = {
  status: 'published';
  intent: BulkImportPublicationResourceIdentity;
  confirmed: BulkImportPublicationReference;
  contentRevision: string;
  attempt: BulkImportPublicationAttempt;
  transactionSignature: string | null;
  confirmedAt: string;
  updatedAt: string | null;
};

export type BulkImportPublicationStep =
  | BulkImportPublicationNotStartedStep
  | BulkImportPublicationInProgressStep
  | BulkImportPublicationFailedStep
  | BulkImportPublicationUnknownStep
  | BulkImportPublicationPublishedStep;

export type BulkImportPublicationStepStatus = BulkImportPublicationStep['status'];

export type BulkImportPublicationSource = {
  status: BulkImportPublicationSourceStatus;
  attempt: BulkImportPublicationAttempt | null;
  updatedAt: string | null;
};

export type BulkImportPublicationJournal = {
  schemaVersion: 2;
  source: BulkImportPublicationSource;
  audio: BulkImportPublicationStep;
  cover: BulkImportPublicationStep;
  metadata: BulkImportPublicationStep;
};

// ── Row and Batch ──────────────────────────────────────────────────

export type BulkImportRow = {
  id: string;
  selected: boolean;
  localSource: BulkImportLocalSourceDescriptor | null;
  /**
   * Monotonic identity for the current audio source assignment. Row
   * identity never implies source identity. Incrementing this value
   * invalidates any in-flight analysis that captured an older value.
   */
  sourceGeneration: number;
  /**
   * True only while the current session still holds a usable transient
   * handle for the audio source. Persisted rows reload with false.
   */
  audioSourceAvailable: boolean;
  /**
   * True only while the current session still holds a usable transient
   * Blob/File for the cover draft. Persisted rows reload with false,
   * even when the cover metadata intent is retained.
   */
  coverSourceAvailable: boolean;
  metadata: BulkImportMetadataDraft;
  manualFields: BulkImportMetadataField[];
  provenance: BulkImportMetadataProvenance;
  durationMs: number | null;
  durationSource: BulkImportDurationSource;
  cover: BulkImportCoverDraft | null;
  extraction: BulkImportExtractionState;
  publication: BulkImportPublicationJournal;
};

export type BulkImportBatch = {
  schemaVersion: 2;
  id: string;
  role: BulkImportRole;
  scope: string;
  createdAt: string;
  updatedAt: string;
  rows: BulkImportRow[];
};

// ── Transient Registry ─────────────────────────────────────────────

/**
 * In-memory-only handles for one row/source generation. Never persisted.
 * The registry is keyed by batch ID + row ID + source generation.
 */
export type BulkImportTransientEntry = {
  batchId: string;
  rowId: string;
  sourceGeneration: number;
  audioFile: File | null;
  coverBlob: Blob | null;
  coverPreviewUrl: string | null;
};

// ── Embedded Extraction ────────────────────────────────────────────

export type EmbeddedAudioPicture = {
  data: Uint8Array;
  format: string;
  fileName?: string;
};

export type EmbeddedAudioMetadata = {
  artist: string;
  title: string;
  album: string;
  releaseDate: string;
  genres: string[];
  durationMs: number | null;
  picture: EmbeddedAudioPicture | null;
};

export type AppliedBulkImportExtraction = {
  metadata: EmbeddedAudioMetadata;
  durationMs: number | null;
  durationSource: BulkImportDurationSource;
  coverPreviewUrl: string | null;
};
