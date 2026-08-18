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

// ── Track Creation ──────────────────────────────────────────────────

export type CreateTrackInput = {
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
};

export function createTrack(input: CreateTrackInput): Track {
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

  const now = new Date().toISOString();

  return {
    schemaVersion: 1,
    trackId: generateId(),
    ownerAddress: input.ownerAddress,
    title: input.title.trim(),
    artist: input.artist,
    description: input.description,
    audio: input.audio,
    cover: input.cover,
    durationMs: input.durationMs,
    genres: input.genres,
    tags: input.tags,
    source: input.source,
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

  return {
    ...track,
    ...input,
    title: input.title !== undefined ? input.title.trim() : track.title,
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
