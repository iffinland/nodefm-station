/* ============================================================
 * NodeFM Station — Request Show Domain Service
 *
 * Dynamic program definition, deterministic seeded fallback,
 * canonical occurrence generation, validation, and QDN identity.
 *
 * The generator is pure: no Date.now(), Math.random(), Map/Object
 * iteration ordering, network order, or wall clock. Callers pass
 * an explicit generatedAt UTC timestamp.
 * ============================================================ */

import type {
  DynamicProgramDefinition,
  DynamicProgramOccurrence,
  ScheduleEvent,
  Track,
} from '../../../types/domain';
import { generateId } from '../../../utils/id';
import { isValidDurationMs } from '../../../utils/duration';
import { isRecord } from '../../../utils/record';
import { isNonEmptyTrimmedString } from '../../../utils/validation';
import { parseUtcTimestampMs } from '../../radio/timeline/timelineMath';
import type { RankedLikedTrack } from '../../likes/services/likeService';

export const REQUEST_SHOW_QDN_SERVICE = 'JSON';
export const DYNAMIC_PROGRAM_IDENTIFIER_PREFIX = 'nodefm-program-';
export const REQUEST_SHOW_OCCURRENCE_IDENTIFIER_PREFIX = 'nodefm-program-occurrence-';

export type RequestShowGenerationErrorCode =
  | 'invalid-schedule-event'
  | 'invalid-program-definition'
  | 'invalid-candidate-track'
  | 'no-eligible-tracks';

export type RequestShowGenerationResult =
  | { ok: true; occurrence: DynamicProgramOccurrence }
  | { ok: false; code: RequestShowGenerationErrorCode; message: string };

export type CreateDynamicProgramDefinitionInput = {
  title: string;
  targetDurationMs: number;
};

export function getDynamicProgramQdnIdentifier(programDefinitionId: string): string {
  return `${DYNAMIC_PROGRAM_IDENTIFIER_PREFIX}${programDefinitionId}`;
}

export function getRequestShowOccurrenceQdnIdentifier(scheduleEventId: string): string {
  return `${REQUEST_SHOW_OCCURRENCE_IDENTIFIER_PREFIX}${scheduleEventId}`;
}

export function buildRequestShowOccurrenceId(scheduleEventId: string): string {
  return `occurrence-${scheduleEventId}`;
}

export function isValidDynamicProgramDefinition(value: unknown): value is DynamicProgramDefinition {
  if (!isRecord(value)) {
    return false;
  }

  const candidate = value as unknown as DynamicProgramDefinition;

  return (
    candidate.schemaVersion === 1 &&
    isNonEmptyTrimmedString(candidate.programDefinitionId) &&
    candidate.type === 'request-show' &&
    isNonEmptyTrimmedString(candidate.title) &&
    isValidDurationMs(candidate.targetDurationMs) &&
    !!candidate.ranking &&
    candidate.ranking.strategy === 'most-liked' &&
    !!candidate.fallback &&
    candidate.fallback.enabled === true &&
    candidate.fallback.source === 'station-library' &&
    candidate.fallback.strategy === 'deterministic-random' &&
    typeof candidate.updatedAt === 'string' &&
    parseUtcTimestampMs(candidate.updatedAt) !== null
  );
}

export function createDynamicProgramDefinition(
  input: CreateDynamicProgramDefinitionInput,
): DynamicProgramDefinition {
  if (!isNonEmptyTrimmedString(input.title)) {
    throw new Error('Request Show title must be a non-empty string.');
  }

  if (!isValidDurationMs(input.targetDurationMs)) {
    throw new Error('Request Show target duration must be a positive integer in milliseconds.');
  }

  const now = new Date().toISOString();

  return {
    schemaVersion: 1,
    programDefinitionId: generateId(),
    type: 'request-show',
    title: input.title.trim(),
    targetDurationMs: input.targetDurationMs,
    ranking: { strategy: 'most-liked' },
    fallback: {
      enabled: true,
      source: 'station-library',
      strategy: 'deterministic-random',
    },
    updatedAt: now,
  };
}

export function serializeDynamicProgramDefinitionForQdn(
  definition: DynamicProgramDefinition,
): string {
  return JSON.stringify(definition);
}

export function deserializeDynamicProgramDefinitionFromQdn(
  value: unknown,
): DynamicProgramDefinition | null {
  return isValidDynamicProgramDefinition(value) ? (value as DynamicProgramDefinition) : null;
}

export function isValidDynamicProgramOccurrence(value: unknown): value is DynamicProgramOccurrence {
  if (!isRecord(value)) {
    return false;
  }

  const candidate = value as unknown as DynamicProgramOccurrence;

  return (
    candidate.schemaVersion === 1 &&
    isNonEmptyTrimmedString(candidate.occurrenceId) &&
    isNonEmptyTrimmedString(candidate.programDefinitionId) &&
    isNonEmptyTrimmedString(candidate.scheduleEventId) &&
    parseUtcTimestampMs(candidate.startUtc) !== null &&
    parseUtcTimestampMs(candidate.endUtc) !== null &&
    parseUtcTimestampMs(candidate.startUtc)! < parseUtcTimestampMs(candidate.endUtc)! &&
    parseUtcTimestampMs(candidate.generatedAt) !== null &&
    Array.isArray(candidate.tracks) &&
    candidate.tracks.length > 0 &&
    candidate.tracks.every(
      (track) =>
        isRecord(track) &&
        isNonEmptyTrimmedString(track.trackId) &&
        isValidDurationMs(track.durationMs) &&
        (track.source === 'liked' || track.source === 'fallback'),
    ) &&
    isNonEmptyTrimmedString(candidate.seed)
  );
}

export function serializeDynamicProgramOccurrenceForQdn(
  occurrence: DynamicProgramOccurrence,
): string {
  return JSON.stringify(occurrence);
}

export function deserializeDynamicProgramOccurrenceFromQdn(
  value: unknown,
): DynamicProgramOccurrence | null {
  return isValidDynamicProgramOccurrence(value) ? (value as DynamicProgramOccurrence) : null;
}

function fnv1aHash(value: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

function hashToSeed(value: string): number {
  return Number.parseInt(fnv1aHash(value), 16) >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let result = state;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function shuffleDeterministic<T>(values: readonly T[], seed: number): T[] {
  const result = [...values];
  const random = mulberry32(seed);

  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const current = result[index];
    result[index] = result[swapIndex];
    result[swapIndex] = current;
  }

  return result;
}

export function buildRequestShowSeed(
  programDefinitionId: string,
  scheduleEventId: string,
  startUtc: string,
): string {
  return `nodefm-request-show\u0000${programDefinitionId}\u0000${scheduleEventId}\u0000${startUtc}`;
}

function validCandidateTracks(tracks: readonly Track[]): Track[] {
  const seen = new Set<string>();
  const candidates: Track[] = [];

  for (const track of [...tracks].sort((left, right) =>
    left.trackId.localeCompare(right.trackId),
  )) {
    if (!track || !isNonEmptyTrimmedString(track.trackId) || !isValidDurationMs(track.durationMs)) {
      continue;
    }

    if (seen.has(track.trackId)) {
      continue;
    }

    seen.add(track.trackId);
    candidates.push(track);
  }

  return candidates;
}

function appendTrack(
  tracks: DynamicProgramOccurrence['tracks'],
  track: Track,
  source: 'liked' | 'fallback',
): void {
  tracks.push({
    trackId: track.trackId,
    durationMs: track.durationMs,
    source,
  });
}

/**
 * Generate an immutable Request Show occurrence.
 *
 * Policy:
 * - rank liked tracks by the supplied canonical ranking;
 * - include the first liked track if one exists (even if it will be
 *   cut at the event boundary);
 * - continue adding liked tracks only while doing so does not cross
 *   the event interval;
 * - fill remaining time with a seeded deterministic shuffle of the
 *   station's eligible non-liked tracks;
 * - if no liked tracks exist, the first fallback track is still
 *   included so the occurrence has at least one playable track;
 * - if no eligible tracks exist at all, generation fails explicitly.
 */
export function generateRequestShowOccurrence(
  scheduleEvent: ScheduleEvent,
  definition: DynamicProgramDefinition,
  eligibleTracks: readonly Track[],
  rankedLikedTracks: readonly RankedLikedTrack[],
  generatedAt: string,
): RequestShowGenerationResult {
  if (
    scheduleEvent.source.type !== 'dynamic-program' ||
    scheduleEvent.source.programDefinitionId !== definition.programDefinitionId
  ) {
    return {
      ok: false,
      code: 'invalid-schedule-event',
      message: 'Schedule event does not reference the Request Show definition.',
    };
  }

  if (!isValidDynamicProgramDefinition(definition)) {
    return {
      ok: false,
      code: 'invalid-program-definition',
      message: 'Request Show definition is invalid.',
    };
  }

  const eventStart = parseUtcTimestampMs(scheduleEvent.startUtc);
  const eventEnd = parseUtcTimestampMs(scheduleEvent.endUtc);

  if (eventStart === null || eventEnd === null || eventStart >= eventEnd) {
    return {
      ok: false,
      code: 'invalid-schedule-event',
      message: 'Request Show schedule event has an invalid UTC interval.',
    };
  }

  if (parseUtcTimestampMs(generatedAt) === null) {
    return {
      ok: false,
      code: 'invalid-schedule-event',
      message: 'Request Show generatedAt must be a valid UTC timestamp.',
    };
  }

  const candidates = validCandidateTracks(eligibleTracks);
  if (candidates.length === 0) {
    return {
      ok: false,
      code: 'no-eligible-tracks',
      message: 'No schedule-eligible station tracks are available for Request Show.',
    };
  }

  const candidatesById = new Map(candidates.map((track) => [track.trackId, track]));
  const slotDurationMs = eventEnd - eventStart;
  const tracks: DynamicProgramOccurrence['tracks'] = [];
  const selectedTrackIds = new Set<string>();

  const sortedLikedTracks = [...rankedLikedTracks]
    .filter((ranked) => candidatesById.has(ranked.trackId))
    .sort((left, right) => {
      if (right.likeCount !== left.likeCount) {
        return right.likeCount - left.likeCount;
      }

      return left.trackId.localeCompare(right.trackId);
    });

  let plannedDurationMs = 0;

  for (const ranked of sortedLikedTracks) {
    const track = candidatesById.get(ranked.trackId);
    if (!track) {
      continue;
    }

    if (selectedTrackIds.has(track.trackId)) {
      continue;
    }

    if (tracks.length === 0) {
      appendTrack(tracks, track, 'liked');
      plannedDurationMs = track.durationMs;
      selectedTrackIds.add(track.trackId);
      continue;
    }

    if (plannedDurationMs + track.durationMs <= slotDurationMs) {
      appendTrack(tracks, track, 'liked');
      plannedDurationMs += track.durationMs;
      selectedTrackIds.add(track.trackId);
    }
  }

  const fallbackCandidates = candidates.filter((track) => !selectedTrackIds.has(track.trackId));
  const fallbackOrder = shuffleDeterministic(
    fallbackCandidates,
    hashToSeed(
      buildRequestShowSeed(
        definition.programDefinitionId,
        scheduleEvent.eventId,
        scheduleEvent.startUtc,
      ),
    ),
  );

  for (const track of fallbackOrder) {
    if (tracks.length === 0) {
      appendTrack(tracks, track, 'fallback');
      plannedDurationMs = track.durationMs;
      selectedTrackIds.add(track.trackId);
      continue;
    }

    if (plannedDurationMs + track.durationMs <= slotDurationMs) {
      appendTrack(tracks, track, 'fallback');
      plannedDurationMs += track.durationMs;
      selectedTrackIds.add(track.trackId);
    }
  }

  if (tracks.length === 0) {
    return {
      ok: false,
      code: 'no-eligible-tracks',
      message: 'Request Show could not select any playable tracks.',
    };
  }

  const seed = buildRequestShowSeed(
    definition.programDefinitionId,
    scheduleEvent.eventId,
    scheduleEvent.startUtc,
  );

  const occurrence: DynamicProgramOccurrence = {
    schemaVersion: 1,
    occurrenceId: buildRequestShowOccurrenceId(scheduleEvent.eventId),
    programDefinitionId: definition.programDefinitionId,
    scheduleEventId: scheduleEvent.eventId,
    startUtc: scheduleEvent.startUtc,
    endUtc: scheduleEvent.endUtc,
    generatedAt,
    tracks,
    seed,
  };

  return { ok: true, occurrence };
}
