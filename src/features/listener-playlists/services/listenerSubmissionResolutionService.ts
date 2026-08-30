/* ============================================================
 * NodeFM Station — Listener Submission Resolution Service
 *
 * Read-only, direct resolution for one listener submission in the
 * context of a listener-owned playlist draft. It reuses the immutable
 * listener submission and station moderation contracts already used by
 * the admin Listener Uploads pipeline.
 * ============================================================ */

import { fetchQdnResourceData } from '../../../qortium/qdn';
import {
  deserializeSubmissionFromQdn,
  deserializeSubmissionModerationFromQdn,
  getAcceptedSubmissionTrackId,
  getSubmissionModerationQdnIdentifier,
  getSubmissionQdnIdentifier,
  validateSubmissionStructuralIntegrity,
} from '../../listener-submissions/services/submissionService';
import type { ListenerSubmissionResolution } from './listenerPlaylistService';

export type ResolveListenerSubmissionInput = {
  stationPublisherName: string;
  stationOwnerAddress: string;
  listenerName: string;
  listenerAddress: string;
  submissionId: string;
};

export async function resolveListenerSubmission(
  input: ResolveListenerSubmissionInput,
): Promise<ListenerSubmissionResolution> {
  const submissionIdentifier = getSubmissionQdnIdentifier(input.submissionId);

  const submissionPayload = await fetchQdnResourceData({
    service: 'JSON',
    name: input.listenerName,
    identifier: submissionIdentifier,
  });
  const submission = deserializeSubmissionFromQdn(submissionPayload);

  if (!submission) {
    return {
      submissionId: input.submissionId,
      status: 'UNRESOLVED',
      title: input.submissionId,
      durationMs: 0,
    };
  }

  const structural = validateSubmissionStructuralIntegrity(
    submission,
    input.listenerName,
    submissionIdentifier,
  );

  if (!structural.ok || submission.submitterAddress.trim() !== input.listenerAddress.trim()) {
    return {
      submissionId: input.submissionId,
      status: 'UNRESOLVED',
      title: submission.title,
      artist: submission.artist,
      durationMs: submission.durationMs,
    };
  }

  let moderationPayload: unknown;

  try {
    moderationPayload = await fetchQdnResourceData({
      service: 'JSON',
      name: input.stationPublisherName,
      identifier: getSubmissionModerationQdnIdentifier(input.submissionId),
    });
  } catch {
    return {
      submissionId: input.submissionId,
      status: 'PENDING',
      title: submission.title,
      artist: submission.artist,
      durationMs: submission.durationMs,
    };
  }

  const moderation = deserializeSubmissionModerationFromQdn(moderationPayload);
  if (!moderation || moderation.submissionId !== input.submissionId) {
    return {
      submissionId: input.submissionId,
      status: 'UNRESOLVED',
      title: submission.title,
      artist: submission.artist,
      durationMs: submission.durationMs,
    };
  }

  if (moderation.moderatorAddress.trim() !== input.stationOwnerAddress.trim()) {
    return {
      submissionId: input.submissionId,
      status: 'UNRESOLVED',
      title: submission.title,
      artist: submission.artist,
      durationMs: submission.durationMs,
    };
  }

  if (moderation.decision === 'accepted') {
    const acceptedTrackId = moderation.acceptedTrackId;
    if (acceptedTrackId !== getAcceptedSubmissionTrackId(input.submissionId)) {
      return {
        submissionId: input.submissionId,
        status: 'UNRESOLVED',
        title: submission.title,
        artist: submission.artist,
        durationMs: submission.durationMs,
      };
    }

    return {
      submissionId: input.submissionId,
      status: 'ACCEPTED',
      acceptedTrackId,
      title: submission.title,
      artist: submission.artist,
      durationMs: submission.durationMs,
    };
  }

  return {
    submissionId: input.submissionId,
    status: 'REJECTED',
    title: submission.title,
    artist: submission.artist,
    durationMs: submission.durationMs,
  };
}

export async function resolveListenerSubmissionEntries(
  input: Omit<ResolveListenerSubmissionInput, 'submissionId'> & {
    submissionIds: readonly string[];
  },
): Promise<ListenerSubmissionResolution[]> {
  const resolutions = await Promise.all(
    input.submissionIds.map((submissionId) =>
      resolveListenerSubmission({
        stationPublisherName: input.stationPublisherName,
        stationOwnerAddress: input.stationOwnerAddress,
        listenerName: input.listenerName,
        listenerAddress: input.listenerAddress,
        submissionId,
      }).catch(() => ({
        submissionId,
        status: 'UNRESOLVED' as const,
        title: submissionId,
        durationMs: 0,
      })),
    ),
  );

  return resolutions;
}
