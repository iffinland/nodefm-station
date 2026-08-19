/* ============================================================
 * NodeFM Station — Radio Timeline Math
 *
 * Small, pure numeric/record helpers shared by the timeline
 * engine. No wall clock, React, QDN, or audio access here.
 * ============================================================ */

import { isValidDurationMs } from '../../../utils/duration';
import type {
  DynamicProgramOccurrence,
  PlaylistVersion,
  PlaylistVersionTrack,
} from '../../../types/domain';

export function floorMod(value: number, modulus: number): number {
  if (
    !Number.isFinite(value) ||
    !Number.isFinite(modulus) ||
    modulus <= 0 ||
    !Number.isInteger(modulus)
  ) {
    return Number.NaN;
  }

  return value - Math.floor(value / modulus) * modulus;
}

export function parseUtcTimestampMs(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }

  const trimmed = value.trim();

  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(trimmed)) {
    return null;
  }

  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getPlaylistDurationMs(tracks: readonly PlaylistVersionTrack[]): number {
  let total = 0;

  for (const track of tracks) {
    if (!isValidDurationMs(track.durationMs)) {
      return Number.NaN;
    }

    total += track.durationMs;
  }

  return total;
}

export function isValidPlaylistVersionRecord(value: unknown): value is PlaylistVersion {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<PlaylistVersion>;

  if (
    typeof candidate.versionId !== 'string' ||
    candidate.versionId.trim() === '' ||
    typeof candidate.playlistId !== 'string' ||
    candidate.playlistId.trim() === '' ||
    !Array.isArray(candidate.tracks) ||
    candidate.tracks.length === 0
  ) {
    return false;
  }

  if (!candidate.tracks.every(isValidPlaylistVersionTrackRecord)) {
    return false;
  }

  const total = getPlaylistDurationMs(candidate.tracks);
  return Number.isFinite(total) && total === candidate.totalDurationMs;
}

export function isValidPlaylistVersionTrackRecord(value: unknown): value is PlaylistVersionTrack {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<PlaylistVersionTrack>;
  return (
    typeof candidate.trackId === 'string' &&
    candidate.trackId.trim() !== '' &&
    isValidDurationMs(candidate.durationMs)
  );
}

export function isValidDynamicOccurrenceRecord(value: unknown): value is DynamicProgramOccurrence {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<DynamicProgramOccurrence>;

  return (
    typeof candidate.occurrenceId === 'string' &&
    candidate.occurrenceId.trim() !== '' &&
    typeof candidate.scheduleEventId === 'string' &&
    candidate.scheduleEventId.trim() !== '' &&
    parseUtcTimestampMs(candidate.startUtc) !== null &&
    parseUtcTimestampMs(candidate.endUtc) !== null &&
    Array.isArray(candidate.tracks) &&
    candidate.tracks.length > 0 &&
    candidate.tracks.every(isValidPlaylistVersionTrackRecord)
  );
}

export type LocatedTrack = {
  track: PlaylistVersionTrack;
  trackIndex: number;
  trackStartWithinSourceMs: number;
  trackEndWithinSourceMs: number;
};

export function locateTrackAtPosition(
  tracks: readonly PlaylistVersionTrack[],
  positionMs: number,
): LocatedTrack | null {
  if (
    tracks.length === 0 ||
    !Number.isFinite(positionMs) ||
    positionMs < 0 ||
    !Number.isInteger(positionMs)
  ) {
    return null;
  }

  let cursor = 0;

  for (let index = 0; index < tracks.length; index += 1) {
    const track = tracks[index];

    if (!isValidPlaylistVersionTrackRecord(track)) {
      return null;
    }

    const end = cursor + track.durationMs;

    if (positionMs < end) {
      return {
        track,
        trackIndex: index,
        trackStartWithinSourceMs: cursor,
        trackEndWithinSourceMs: end,
      };
    }

    cursor = end;
  }

  return null;
}
