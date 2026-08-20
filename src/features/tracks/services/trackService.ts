/* ============================================================
 * NodeFM Station — Track Service
 *
 * Domain logic for track management.
 * Pure functions for track creation, validation, and status.
 * ============================================================ */

import type { Track, TrackSource, QdnResourceRef } from '../../../types/domain';
import { generateId } from '../../../utils/id';
import { isValidDurationMs, isScheduleEligibleDuration } from '../../../utils/duration';
import { isRecord } from '../../../utils/record';
import { isNonEmptyTrimmedString } from '../../../utils/validation';

const MAX_TRACK_TAXONOMY_VALUES = 5;
const MAX_TRACK_TAXONOMY_VALUE_LENGTH = 20;

function normalizeTrackTaxonomyValues(
  values: string[] | undefined,
  label: string,
): string[] | undefined {
  if (values === undefined) return undefined;

  if (!Array.isArray(values) || values.length > MAX_TRACK_TAXONOMY_VALUES) {
    throw new Error(`${label} must contain at most ${MAX_TRACK_TAXONOMY_VALUES} values.`);
  }

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const raw of values) {
    if (!isNonEmptyTrimmedString(raw)) {
      throw new Error(`${label} values must be non-empty strings.`);
    }

    const value = raw.trim().replace(/\s+/g, ' ');
    if (value.length > MAX_TRACK_TAXONOMY_VALUE_LENGTH) {
      throw new Error(
        `${label} values must be at most ${MAX_TRACK_TAXONOMY_VALUE_LENGTH} characters.`,
      );
    }

    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(value);
  }

  return normalized;
}

// ── Track Creation ──────────────────────────────────────────────────

export type CreateTrackInput = {
  trackId?: string;
  title: string;
  artist?: string;
  description?: string;
  audio: QdnResourceRef;
  cover?: QdnResourceRef;
  durationMs: number;
  genres?: string[];
  tags?: string[];
  source: TrackSource;
  ownerAddress: string;
  submissionId?: string;
  submissionRef?: QdnResourceRef;
};

export function createTrack(input: CreateTrackInput): Track {
  if (input.trackId !== undefined && !isNonEmptyTrimmedString(input.trackId)) {
    throw new Error('Track ID must be a non-empty string when provided.');
  }

  if (input.submissionId !== undefined && !isNonEmptyTrimmedString(input.submissionId)) {
    throw new Error('Submission lineage ID must be a non-empty string when provided.');
  }

  if (input.submissionRef !== undefined && !isValidQdnResourceRef(input.submissionRef)) {
    throw new Error('Submission lineage reference must be a valid QDN resource reference.');
  }

  if (!isNonEmptyTrimmedString(input.title)) {
    throw new Error('Track title must be a non-empty string.');
  }

  if (!isValidQdnResourceRef(input.audio)) {
    throw new Error('Track audio must be a valid QDN resource reference.');
  }

  if (!isValidDurationMs(input.durationMs)) {
    throw new Error('A valid positive integer durationMs is required to create a track.');
  }

  if (input.cover !== undefined && !isValidQdnResourceRef(input.cover)) {
    throw new Error('Track cover must be a valid QDN resource reference.');
  }

  const genres = normalizeTrackTaxonomyValues(input.genres, 'Track genres');
  const tags = normalizeTrackTaxonomyValues(input.tags, 'Track tags');

  const now = new Date().toISOString();

  return {
    schemaVersion: 1,
    trackId: input.trackId?.trim() || generateId(),
    ownerAddress: input.ownerAddress,
    title: input.title.trim(),
    artist: input.artist,
    description: input.description,
    audio: input.audio,
    cover: input.cover,
    durationMs: input.durationMs,
    genres,
    tags,
    source: input.source,
    submissionId: input.submissionId,
    submissionRef: input.submissionRef,
    createdAt: now,
    updatedAt: now,
  };
}

// ── Track Editing ───────────────────────────────────────────────────

export type EditTrackInput = Partial<
  Pick<Track, 'title' | 'artist' | 'description' | 'genres' | 'tags' | 'cover'>
>;

export function editTrack(track: Track, input: EditTrackInput): Track {
  if (input.title !== undefined && !isNonEmptyTrimmedString(input.title)) {
    throw new Error('Track title must be a non-empty string.');
  }

  if (input.cover !== undefined && !isValidQdnResourceRef(input.cover)) {
    throw new Error('Track cover must be a valid QDN resource reference.');
  }

  const genres = normalizeTrackTaxonomyValues(input.genres, 'Track genres');
  const tags = normalizeTrackTaxonomyValues(input.tags, 'Track tags');

  return {
    ...track,
    ...input,
    title: input.title !== undefined ? input.title.trim() : track.title,
    genres: input.genres !== undefined ? genres : track.genres,
    tags: input.tags !== undefined ? tags : track.tags,
    updatedAt: new Date().toISOString(),
  };
}

// ── Track Status ────────────────────────────────────────────────────

export type TrackStatus = {
  hasValidDuration: boolean;
  isScheduleEligible: boolean;
  hasAudio: boolean;
  hasCover: boolean;
  source: TrackSource;
};

export function getTrackStatus(track: Track): TrackStatus {
  return {
    hasValidDuration: isValidDurationMs(track.durationMs),
    isScheduleEligible: isScheduleEligibleDuration(track.durationMs),
    hasAudio: !!track.audio?.name,
    hasCover: !!track.cover?.name,
    source: track.source,
  };
}

// ── Track Identity for QDN ──────────────────────────────────────────
//
// QDN resource identity lives in the `identifier` field.
// The `name` field is the publisher's registered Qortium name.

/** Generate a QDN identifier for a track metadata resource. */
export function getTrackQdnIdentifier(trackId: string): string {
  return `nodefm-track-${trackId}`;
}

/** Generate a QDN identifier for an audio resource. */
export function getAudioQdnIdentifier(): string {
  return `nodefm-audio-${generateId()}`;
}

/** Generate a QDN identifier for a cover image resource. */
export function getCoverQdnIdentifier(): string {
  return `nodefm-cover-${generateId()}`;
}

/** A QDN resource reference requires a non-empty service and name. */
export function isValidQdnResourceRef(value: unknown): value is QdnResourceRef {
  return (
    isRecord(value) && isNonEmptyTrimmedString(value.service) && isNonEmptyTrimmedString(value.name)
  );
}

// ── Serialization for QDN ───────────────────────────────────────────

export function serializeTrackForQdn(track: Track): string {
  return JSON.stringify(track);
}

export function deserializeTrackFromQdn(value: unknown): Track | null {
  if (!isRecord(value)) {
    return null;
  }

  const parsed = value as unknown as Track;

  if (
    typeof parsed.trackId !== 'string' ||
    !isNonEmptyTrimmedString(parsed.title) ||
    !isValidQdnResourceRef(parsed.audio) ||
    !isValidDurationMs(parsed.durationMs)
  ) {
    return null;
  }

  return parsed;
}
