/* ============================================================
 * NodeFM Station — Bulk Import Content Revision
 *
 * Deterministic, transport-neutral fingerprints for the exact draft
 * content a publication step proves. These are not cryptographic
 * signatures; they are stable local revisions used to invalidate
 * stale completion claims.
 * ============================================================ */

import type {
  BulkImportCoverDraft,
  BulkImportLocalSourceDescriptor,
  BulkImportMetadataDraft,
} from './types';

const FIELD_SEPARATOR = '\u001f';
const ARRAY_SEPARATOR = '\u001e';

/** Small deterministic FNV-1a fingerprint. Stable across sessions. */
export function stableContentFingerprint(parts: readonly string[]): string {
  const input = parts.join(FIELD_SEPARATOR);
  let hash = 0x811c9dc5;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function computeAudioContentRevision(
  source: BulkImportLocalSourceDescriptor | null,
  sourceGeneration: number,
): string | null {
  if (!source) return null;

  // Audio identity is bound to the row's monotonic source generation as well
  // as its descriptor. A replacement that happens to keep the same
  // filename/MIME/size still advances the generation and invalidates old
  // publication/skip evidence.
  return stableContentFingerprint([
    'audio',
    'source-generation',
    String(sourceGeneration),
    source.fileName,
    source.mimeType,
    String(source.sizeBytes),
  ]);
}

export function computeMetadataContentRevision(metadata: BulkImportMetadataDraft): string {
  return stableContentFingerprint([
    'metadata',
    metadata.artist,
    metadata.title,
    metadata.album,
    metadata.releaseDate,
    metadata.genres.join(ARRAY_SEPARATOR),
    metadata.tags.join(ARRAY_SEPARATOR),
  ]);
}

export function computeCoverContentRevision(cover: BulkImportCoverDraft | null): string | null {
  if (!cover) return null;

  return stableContentFingerprint([
    'cover',
    cover.origin,
    cover.fileName ?? '',
    cover.mimeType ?? '',
    cover.sizeBytes === null ? '' : String(cover.sizeBytes),
  ]);
}
