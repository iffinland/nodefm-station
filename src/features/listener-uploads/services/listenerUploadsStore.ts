/* ============================================================
 * NodeFM Station — Listener Uploads Store
 *
 * Listener-facing, account/registered-name-scoped discovery of tracks
 * the current listener has already published. Station moderation is
 * resolved as separate informational state and never gates personal
 * playlist use.
 * ============================================================ */

import type { ListenerTrackSubmission, SubmissionModeration, Track } from '../../../types/domain';
import { fetchQdnResourceData, searchQdnResources } from '../../../qortium/qdn';
import { isConfirmedQdnNotFoundError } from '../../../qortium/qdnReadError';
import {
  deserializeSubmissionFromQdn,
  deserializeSubmissionModerationFromQdn,
  getAcceptedSubmissionTrackId,
  getSubmissionModerationQdnIdentifier,
  isSubmissionModerationQdnIdentifier,
  isSubmissionQdnIdentifier,
  validateSubmissionStructuralIntegrity,
  SUBMISSION_IDENTIFIER_PREFIX,
} from '../../listener-submissions/services/submissionService';
import { listenerSubmissionToTrack } from './listenerTrackService';

type StoreListener = () => void;

export type ListenerUploadStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'UNRESOLVED';

export type ListenerUpload = {
  submission: ListenerTrackSubmission;
  track: Track;
  status: ListenerUploadStatus;
  moderation: SubmissionModeration | null;
  moderationError?: string;
};

let uploads: ListenerUpload[] = [];
let loaded = false;
let loading = false;
let error: string | null = null;
let incomplete = false;
let activeScope: string | null = null;
let epoch = 0;
let loadPromise: Promise<void> | null = null;

const listeners = new Set<StoreListener>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

function scopeKey(
  ownerName: string,
  ownerAddress: string,
  stationPublisherName: string,
  stationOwnerAddress: string,
): string {
  return `${ownerAddress.trim()}\u0000${ownerName.trim()}\u0000${stationPublisherName.trim()}\u0000${stationOwnerAddress.trim()}`;
}

export function subscribeToListenerUploads(listener: StoreListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getListenerUploads(): ListenerUpload[] {
  return uploads.map((entry) => ({
    ...entry,
    submission: { ...entry.submission },
    track: { ...entry.track },
    moderation: entry.moderation ? { ...entry.moderation } : null,
  }));
}

export function getListenerUploadsLoaded(): boolean {
  return loaded;
}

export function getListenerUploadsLoading(): boolean {
  return loading;
}

export function getListenerUploadsError(): string | null {
  return error;
}

export function getListenerUploadsIncomplete(): boolean {
  return incomplete;
}

export function isListenerUploadsCurrentScope(
  ownerName: string,
  ownerAddress: string,
  stationPublisherName: string,
  stationOwnerAddress: string,
): boolean {
  return (
    activeScope === scopeKey(ownerName, ownerAddress, stationPublisherName, stationOwnerAddress)
  );
}

export type ListenerUploadsLoadAction = 'clear' | 'reuse' | 'load';

export function getListenerUploadsLoadAction(
  ownerName: string | null,
  ownerAddress: string | null,
  stationPublisherName: string | null,
  stationOwnerAddress: string | null,
): ListenerUploadsLoadAction {
  if (!ownerName || !ownerAddress || !stationPublisherName || !stationOwnerAddress) {
    return 'clear';
  }

  if (
    isListenerUploadsCurrentScope(
      ownerName,
      ownerAddress,
      stationPublisherName,
      stationOwnerAddress,
    ) &&
    (loaded || loading)
  ) {
    return 'reuse';
  }

  return 'load';
}

async function loadListenerUploadsInternal(
  ownerName: string,
  ownerAddress: string,
  stationPublisherName: string,
  stationOwnerAddress: string,
): Promise<{ uploads: ListenerUpload[]; incomplete: boolean }> {
  const results = await searchQdnResources({
    service: 'JSON',
    name: ownerName,
    query: SUBMISSION_IDENTIFIER_PREFIX,
    prefix: true,
    limit: 1000,
    includeMetadata: true,
  });

  const nextUploads: ListenerUpload[] = [];
  const seen = new Set<string>();
  let nextIncomplete = false;

  for (const result of results) {
    const identifier = result.identifier ?? '';

    if (!isSubmissionQdnIdentifier(identifier) || isSubmissionModerationQdnIdentifier(identifier)) {
      continue;
    }

    if (seen.has(identifier)) continue;
    seen.add(identifier);

    let payload: unknown;
    try {
      payload = await fetchQdnResourceData({
        service: 'JSON',
        name: ownerName,
        identifier,
      });
    } catch (fetchError) {
      if (!isConfirmedQdnNotFoundError(fetchError)) {
        nextIncomplete = true;
      }
      continue;
    }

    const submission = deserializeSubmissionFromQdn(payload);
    if (!submission) {
      nextIncomplete = true;
      continue;
    }

    const structural = validateSubmissionStructuralIntegrity(submission, ownerName, identifier);
    if (
      !structural.ok ||
      submission.submitterName.trim() !== ownerName.trim() ||
      submission.submitterAddress.trim() !== ownerAddress.trim()
    ) {
      nextIncomplete = true;
      continue;
    }

    let moderation: SubmissionModeration | null = null;
    let status: ListenerUploadStatus = 'PENDING';
    let moderationError: string | undefined;

    try {
      const moderationPayload = await fetchQdnResourceData({
        service: 'JSON',
        name: stationPublisherName,
        identifier: getSubmissionModerationQdnIdentifier(submission.submissionId),
      });
      const parsedModeration = deserializeSubmissionModerationFromQdn(moderationPayload);

      if (
        !parsedModeration ||
        parsedModeration.submissionId !== submission.submissionId ||
        parsedModeration.moderatorAddress.trim() !== stationOwnerAddress.trim()
      ) {
        throw new Error('Invalid station moderation resource.');
      }

      if (
        parsedModeration.decision === 'accepted' &&
        parsedModeration.acceptedTrackId !== getAcceptedSubmissionTrackId(submission.submissionId)
      ) {
        throw new Error('Accepted moderation resource has an invalid acceptedTrackId.');
      }

      moderation = parsedModeration;
      status = parsedModeration.decision === 'accepted' ? 'ACCEPTED' : 'REJECTED';
    } catch (moderationErrorValue) {
      if (isConfirmedQdnNotFoundError(moderationErrorValue)) {
        status = 'PENDING';
      } else {
        status = 'UNRESOLVED';
        moderationError =
          moderationErrorValue instanceof Error
            ? moderationErrorValue.message
            : 'Station moderation state could not be resolved.';
        nextIncomplete = true;
      }
    }

    nextUploads.push({
      submission,
      track: listenerSubmissionToTrack(submission),
      status,
      moderation,
      moderationError,
    });
  }

  nextUploads.sort(
    (left, right) =>
      Date.parse(right.submission.submittedAt) - Date.parse(left.submission.submittedAt),
  );

  return { uploads: nextUploads, incomplete: nextIncomplete };
}

export async function loadListenerUploads(
  ownerName: string,
  ownerAddress: string,
  stationPublisherName: string,
  stationOwnerAddress: string,
  force = false,
): Promise<void> {
  const nextScope = scopeKey(ownerName, ownerAddress, stationPublisherName, stationOwnerAddress);

  if (!force && loaded && activeScope === nextScope) {
    return;
  }

  if (!force && loading && activeScope === nextScope && loadPromise) {
    return loadPromise;
  }

  epoch += 1;
  const currentEpoch = epoch;
  const scopeChanged = activeScope !== nextScope;

  if (scopeChanged) {
    uploads = [];
    loaded = false;
    incomplete = false;
    error = null;
  }

  activeScope = nextScope;
  loading = true;
  error = null;
  incomplete = false;
  notify();

  if (!ownerName.trim() || !ownerAddress.trim()) {
    loaded = true;
    loading = false;
    uploads = [];
    notify();
    return;
  }

  loadPromise = loadListenerUploadsInternal(
    ownerName,
    ownerAddress,
    stationPublisherName,
    stationOwnerAddress,
  )
    .then((snapshot) => {
      if (currentEpoch === epoch && activeScope === nextScope) {
        uploads = snapshot.uploads;
        incomplete = snapshot.incomplete;
        loaded = true;
      }
    })
    .catch((loadError) => {
      if (currentEpoch === epoch && activeScope === nextScope) {
        error = loadError instanceof Error ? loadError.message : 'Failed to load listener uploads.';
      }
    })
    .finally(() => {
      if (currentEpoch === epoch && activeScope === nextScope) {
        loading = false;
        loadPromise = null;
        notify();
      }
    });

  return loadPromise;
}

export function resetListenerUploads(): void {
  epoch += 1;
  uploads = [];
  loaded = false;
  loading = false;
  error = null;
  incomplete = false;
  activeScope = null;
  loadPromise = null;
  notify();
}
