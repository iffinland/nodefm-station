/* ============================================================
 * NodeFM Station — Embedded Audio Metadata Extraction
 *
 * Browser-compatible metadata adapter. It delegates parsing to
 * music-metadata's browser `parseBlob` entry point and normalizes
 * the result into NodeFM's small, product-relevant draft shape.
 * ============================================================ */

import { parseBlob } from 'music-metadata';
import type { IAudioMetadata, IPicture } from 'music-metadata';
import { isValidReleaseDateValue } from '../../metadata-intelligence/releaseDate';
import {
  MAX_TAXONOMY_VALUE_LENGTH,
  MAX_TAXONOMY_VALUES,
  normalizeTaxonomyValue,
  taxonomyKey,
} from '../../taxonomy/taxonomyService';
import type { EmbeddedAudioMetadata, EmbeddedAudioPicture } from '../types';

function firstNonEmptyString(...values: Array<string | undefined>): string {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }

  return '';
}

export function normalizeEmbeddedReleaseDate(
  value: string | undefined,
  year: number | undefined,
): string {
  const raw = value?.trim();

  if (raw) {
    const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?/.exec(raw);
    const candidate = match?.[0];

    if (candidate && isValidReleaseDateValue(candidate)) {
      return candidate;
    }
  }

  if (year !== undefined && Number.isInteger(year) && year >= 1000 && year <= 9999) {
    return String(year);
  }

  return '';
}

export function normalizeEmbeddedGenres(genres: readonly string[] | undefined): string[] {
  if (!genres) return [];

  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of genres) {
    if (typeof raw !== 'string') continue;

    for (const piece of raw.split(/[,;/]+/u)) {
      const normalized = normalizeTaxonomyValue(piece);
      if (!normalized || normalized.length > MAX_TAXONOMY_VALUE_LENGTH) continue;

      const key = taxonomyKey(normalized);
      if (seen.has(key)) continue;

      seen.add(key);
      result.push(normalized);

      if (result.length >= MAX_TAXONOMY_VALUES) return result;
    }
  }

  return result;
}

const SUPPORTED_EMBEDDED_IMAGE_TYPES = /^image\/(?:jpeg|png|webp|gif)$/iu;

export function selectEmbeddedPicture(
  pictures: readonly IPicture[] | undefined,
): EmbeddedAudioPicture | null {
  const picture = pictures?.find(
    (candidate) =>
      candidate.data instanceof Uint8Array &&
      candidate.data.length > 0 &&
      typeof candidate.format === 'string' &&
      SUPPORTED_EMBEDDED_IMAGE_TYPES.test(candidate.format),
  );

  if (!picture) return null;

  return {
    data: picture.data,
    format: picture.format.toLowerCase(),
    fileName:
      typeof picture.name === 'string' && picture.name.trim() ? picture.name.trim() : undefined,
  };
}

function normalizeDurationMs(durationSeconds: number | undefined): number | null {
  if (durationSeconds === undefined || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return null;
  }

  return Math.round(durationSeconds * 1000);
}

export function metadataFromMusicMetadata(parsed: IAudioMetadata): EmbeddedAudioMetadata {
  const common = parsed.common;

  return {
    artist: firstNonEmptyString(common.artist, common.artists?.join(', '), common.albumartist),
    title: firstNonEmptyString(common.title),
    album: firstNonEmptyString(common.album),
    releaseDate: normalizeEmbeddedReleaseDate(common.releasedate ?? common.date, common.year),
    genres: normalizeEmbeddedGenres(common.genre),
    durationMs: normalizeDurationMs(parsed.format.duration),
    picture: selectEmbeddedPicture(common.picture),
  };
}

/**
 * Extract embedded metadata from a browser File. Callers are expected
 * to catch failures: one malformed/unsupported file must not poison the
 * surrounding batch.
 */
export async function extractEmbeddedAudioMetadata(file: File): Promise<EmbeddedAudioMetadata> {
  const parsed = await parseBlob(file);
  return metadataFromMusicMetadata(parsed);
}
