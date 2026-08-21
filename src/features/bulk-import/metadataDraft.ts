/* ============================================================
 * NodeFM Station — Bulk Import Metadata Draft Helpers
 *
 * Pure draft/provenance merge logic implementing the effective
 * extraction precedence:
 *   manual edits > non-empty embedded metadata > filename fallback
 *
 * Filename fallback fills only missing Artist/Title; non-empty
 * embedded values overwrite filename guesses; fields the user has
 * manually edited are never overwritten by later analysis.
 * ============================================================ */

import type {
  BulkImportMetadataDraft,
  BulkImportMetadataField,
  BulkImportMetadataProvenance,
  EmbeddedAudioMetadata,
} from './types';
import type { FilenameParseResult } from './filenameParser';

export function createEmptyBulkImportMetadata(): BulkImportMetadataDraft {
  return {
    artist: '',
    title: '',
    album: '',
    releaseDate: '',
    genres: [],
    tags: [],
  };
}

export function createEmptyBulkImportProvenance(): BulkImportMetadataProvenance {
  return {
    artist: 'none',
    title: 'none',
    album: 'none',
    releaseDate: 'none',
    genres: 'none',
    tags: 'none',
  };
}

export type MetadataMerge = {
  metadata: BulkImportMetadataDraft;
  provenance: BulkImportMetadataProvenance;
};

/**
 * Fill only missing Artist/Title from the filename. It never overwrites
 * values already produced by embedded metadata or manual editing.
 */
export function applyFilenameFallbackToMetadata(
  input: MetadataMerge,
  parsed: FilenameParseResult,
): MetadataMerge {
  const metadata = { ...input.metadata };
  const provenance = { ...input.provenance };

  if (!metadata.artist.trim() && parsed.artist.trim()) {
    metadata.artist = parsed.artist.trim();
    provenance.artist = 'filename';
  }

  if (!metadata.title.trim() && parsed.title.trim()) {
    metadata.title = parsed.title.trim();
    provenance.title = 'filename';
  }

  return { metadata, provenance };
}

/**
 * Apply non-empty embedded metadata to fields the user has not manually
 * edited. Embedded values outrank filename-derived values because the
 * merge below intentionally overwrites them.
 */
export function applyEmbeddedMetadataToMetadata(
  input: MetadataMerge,
  manualFields: readonly BulkImportMetadataField[],
  embedded: EmbeddedAudioMetadata,
): MetadataMerge {
  const metadata = { ...input.metadata };
  const provenance = { ...input.provenance };
  const manual = new Set(manualFields);

  const applyString = (
    field: Extract<BulkImportMetadataField, 'artist' | 'title' | 'album' | 'releaseDate'>,
    value: string,
  ) => {
    if (manual.has(field)) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    metadata[field] = trimmed;
    provenance[field] = 'embedded';
  };

  applyString('artist', embedded.artist);
  applyString('title', embedded.title);
  applyString('album', embedded.album);
  applyString('releaseDate', embedded.releaseDate);

  if (!manual.has('genres') && embedded.genres.length > 0) {
    metadata.genres = [...embedded.genres];
    provenance.genres = 'embedded';
  }

  return { metadata, provenance };
}

/**
 * Build a fresh draft for a newly assigned source. Manual edits survive
 * an intentional replacement, while embedded and filename-derived values
 * from the previous source are dropped. The new source's filename then
 * fills only the non-manual Artist/Title fields.
 */
export function resetMetadataForSourceReplacement(
  previous: MetadataMerge,
  manualFields: readonly BulkImportMetadataField[],
  parsed: FilenameParseResult,
): MetadataMerge {
  const manual = new Set(manualFields);
  const metadata = createEmptyBulkImportMetadata();
  const provenance = createEmptyBulkImportProvenance();

  if (manual.has('artist')) {
    metadata.artist = previous.metadata.artist;
    provenance.artist = 'manual';
  }
  if (manual.has('title')) {
    metadata.title = previous.metadata.title;
    provenance.title = 'manual';
  }
  if (manual.has('album')) {
    metadata.album = previous.metadata.album;
    provenance.album = 'manual';
  }
  if (manual.has('releaseDate')) {
    metadata.releaseDate = previous.metadata.releaseDate;
    provenance.releaseDate = 'manual';
  }
  if (manual.has('genres')) {
    metadata.genres = [...previous.metadata.genres];
    provenance.genres = 'manual';
  }
  if (manual.has('tags')) {
    metadata.tags = [...previous.metadata.tags];
    provenance.tags = 'manual';
  }

  return applyFilenameFallbackToMetadata({ metadata, provenance }, parsed);
}
