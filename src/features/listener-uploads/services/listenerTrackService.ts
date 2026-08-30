/* ============================================================
 * NodeFM Station — Listener-Owned Track Service
 *
 * Converts the already-immutable listener Track Submission resource
 * into the same playable Track shape used by station Tracks. A
 * listener does not need to publish a second metadata resource:
 * the submission JSON already contains title/artist/audio/cover and
 * a trustworthy resolved duration immediately after successful
 * listener publication.
 * ============================================================ */

import type { ListenerTrackSubmission, Track } from '../../../types/domain';

/**
 * Stable listener-owned Track identity.
 *
 * This is intentionally the immutable submission ID, not a mutable UI
 * draft identifier or a station-owned accepted track ID. It is already
 * bounded by the submission QDN identifier rules and bound to the
 * listener's registered QDN name through the submission publisher.
 */
export function getListenerOwnedTrackId(submissionId: string): string {
  return submissionId.trim();
}

export function listenerSubmissionToTrack(submission: ListenerTrackSubmission): Track {
  return {
    schemaVersion: 1,
    trackId: getListenerOwnedTrackId(submission.submissionId),
    ownerAddress: submission.submitterAddress,
    title: submission.title,
    artist: submission.artist,
    album: submission.album,
    releaseDate: submission.releaseDate,
    description: submission.description,
    audio: submission.audio,
    cover: submission.cover,
    durationMs: submission.durationMs,
    genres: submission.genres,
    tags: submission.tags,
    source: 'listener-owned',
    createdAt: submission.submittedAt,
    updatedAt: submission.submittedAt,
  };
}
