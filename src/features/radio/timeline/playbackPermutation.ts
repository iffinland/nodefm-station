/* ============================================================
 * NodeFM Station — Playback Permutation Helpers
 *
 * Converts immutable PlaylistVersion track lists into a
 * deterministic playback order for one scheduled occurrence or
 * AutoDJ session. The original version array is never mutated.
 * ============================================================ */

import type { PlaylistVersionTrack, ScheduleEvent } from '../../../types/domain';
import { buildCanonicalSeed, shuffleDeterministic } from '../../../utils/deterministicShuffle';
import { parseUtcTimestampMs } from './timelineMath';

const SCHEDULED_PLAYLIST_SEED_NAMESPACE = 'nodefm-scheduled-playlist';
const AUTODJ_SESSION_SEED_NAMESPACE = 'nodefm-autodj-session';

export function buildScheduledPlaylistPermutationSeed(
  stationId: string,
  playlistVersionId: string,
  scheduleEventId: string,
  occurrenceStartUtcMs: number,
): string {
  return buildCanonicalSeed([
    SCHEDULED_PLAYLIST_SEED_NAMESPACE,
    stationId,
    playlistVersionId,
    scheduleEventId,
    occurrenceStartUtcMs,
  ]);
}

export function buildAutoDjSessionPermutationSeed(
  stationId: string,
  playlistVersionId: string,
  sessionBoundaryUtcMs: number,
): string {
  return buildCanonicalSeed([
    AUTODJ_SESSION_SEED_NAMESPACE,
    stationId,
    playlistVersionId,
    sessionBoundaryUtcMs,
  ]);
}

/**
 * Return the deterministic AutoDJ session boundary UTC ms.
 *
 * A session starts at the station epoch until the first schedule ends;
 * after that it starts at the most recently ended schedule event. This
 * makes each schedule -> AutoDJ transition derive a fresh order while
 * keeping refreshes and mid-session joins stable.
 */
export function resolveAutoDjSessionBoundaryUtcMs(
  nowUtcMs: number,
  stationEpochUtcMs: number,
  scheduleEvents: readonly ScheduleEvent[],
): number {
  let boundaryUtcMs = stationEpochUtcMs;

  for (const event of scheduleEvents) {
    const endUtcMs = parseUtcTimestampMs(event.endUtc);

    if (endUtcMs !== null && endUtcMs <= nowUtcMs && endUtcMs > boundaryUtcMs) {
      boundaryUtcMs = endUtcMs;
    }
  }

  return boundaryUtcMs;
}

/** Derive a deterministic playback permutation of immutable version tracks. */
export function permutePlaylistVersionTracks(
  tracks: readonly PlaylistVersionTrack[],
  seed: string,
): PlaylistVersionTrack[] {
  return shuffleDeterministic(tracks, seed);
}

/**
 * Prevent the immediately previous scheduled track from being repeated as
 * the first AutoDJ track when an alternative exists. The adjustment is a
 * deterministic rotation, so mid-session join math remains stable.
 */
export function avoidImmediateTrackRepeat(
  order: readonly PlaylistVersionTrack[],
  previousTrackId: string | null,
): PlaylistVersionTrack[] {
  if (!previousTrackId || order.length < 2) {
    return [...order];
  }

  if (order[0].trackId !== previousTrackId) {
    return [...order];
  }

  const replacementIndex = order.findIndex(
    (track, index) => index > 0 && track.trackId !== previousTrackId,
  );

  if (replacementIndex === -1) {
    return [...order];
  }

  return [...order.slice(replacementIndex), ...order.slice(0, replacementIndex)];
}
