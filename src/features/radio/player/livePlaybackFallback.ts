/* ============================================================
 * NodeFM Station — Live Playback Fallback
 *
 * Deterministic, resource-scoped fallback for the LIVE player.
 * The canonical radio timeline remains unchanged; this module only
 * advances playback to the next playable candidate when the current
 * candidate is confirmed to be missing/unusable.
 * ============================================================ */

import type { Track } from '../../../types/domain';
import { isConfirmedQdnNotFoundError } from '../../../qortium/qdnReadError';
import type { ResolvedTrackPlayback } from './resolveTrackPlayback';

export type LivePlaybackCandidate = {
  trackId: string;
  durationMs: number;
  metadata: Track | null;
  trackIndex: number;
  trackStartUtcMs: number;
  trackEndUtcMs: number;
};

export type LivePlaybackCandidateResolution =
  | {
      status: 'ready';
      track: Track;
      playback: ResolvedTrackPlayback;
      skippedTrackIds: string[];
      candidateIndex: number;
    }
  | {
      status: 'no-playable-track';
      skippedTrackIds: string[];
    }
  | {
      status: 'fatal';
      code: 'playback-resolution-error';
      message: string;
      trackId?: string;
    };

export const LIVE_PLAYBACK_FATAL_RETRY_DELAY_MS = 5_000;
export const LIVE_PLAYBACK_NO_CANDIDATE_RETRY_DELAY_MS = 15_000;

/**
 * Read failures are retryable because QDN readiness and resource lookup can
 * recover without a timeline change. A complete no-candidate pass uses a
 * longer cooldown so a genuinely missing source does not hammer Core.
 */
export function getLivePlaybackRetryDelayMs(
  resolution: LivePlaybackCandidateResolution,
): number | null {
  if (resolution.status === 'ready') {
    return null;
  }

  return resolution.status === 'no-playable-track'
    ? LIVE_PLAYBACK_NO_CANDIDATE_RETRY_DELAY_MS
    : LIVE_PLAYBACK_FATAL_RETRY_DELAY_MS;
}

export function shouldStartLivePlaybackResolution(
  contextKey: string | null,
  loadedContextKey: string | null,
  resolvingContextKey: string | null,
  retryContextKey: string | null,
  retryAfterUtcMs: number,
  nowUtcMs: number,
): boolean {
  return (
    contextKey !== null &&
    contextKey !== loadedContextKey &&
    contextKey !== resolvingContextKey &&
    (contextKey !== retryContextKey || nowUtcMs >= retryAfterUtcMs)
  );
}

function clipStartIndex(startIndex: number, length: number): number {
  if (!Number.isInteger(startIndex) || startIndex < 0) {
    return 0;
  }

  return Math.min(startIndex, length);
}

/**
 * Resolve the first usable candidate, moving forward deterministically from
 * the supplied start index. Confirmed QDN absence is skippable; transient or
 * unknown failures remain fatal and stop fallback immediately.
 */
export async function resolveLivePlaybackCandidate(
  candidates: readonly LivePlaybackCandidate[],
  options: {
    startIndex?: number;
    sourceEndUtcMs?: number;
    resolveTrack: (track: Track) => Promise<ResolvedTrackPlayback>;
  },
): Promise<LivePlaybackCandidateResolution> {
  const startIndex = clipStartIndex(options.startIndex ?? 0, candidates.length);
  const seenTrackIds = new Set<string>();
  const skippedTrackIds: string[] = [];

  for (let offset = startIndex; offset < candidates.length; offset += 1) {
    const candidate = candidates[offset];

    if (seenTrackIds.has(candidate.trackId)) {
      continue;
    }

    seenTrackIds.add(candidate.trackId);

    // A scheduled source may end part-way through its final track. That track
    // is still the canonical LIVE source until the schedule boundary and must
    // be allowed to resolve; the timeline transition stops it at the boundary.
    // Only candidates that start at or after the boundary are outside the
    // scheduled source.
    if (
      options.sourceEndUtcMs !== undefined &&
      candidate.trackStartUtcMs >= options.sourceEndUtcMs
    ) {
      continue;
    }

    if (!candidate.metadata) {
      skippedTrackIds.push(candidate.trackId);
      continue;
    }

    try {
      const playback = await options.resolveTrack(candidate.metadata);

      return {
        status: 'ready',
        track: candidate.metadata,
        playback,
        skippedTrackIds,
        candidateIndex: offset,
      };
    } catch (error) {
      if (isConfirmedQdnNotFoundError(error)) {
        skippedTrackIds.push(candidate.trackId);
        continue;
      }

      return {
        status: 'fatal',
        code: 'playback-resolution-error',
        message: error instanceof Error ? error.message : 'Unable to resolve live audio.',
        trackId: candidate.trackId,
      };
    }
  }

  return {
    status: 'no-playable-track',
    skippedTrackIds,
  };
}
