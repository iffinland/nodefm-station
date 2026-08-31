/* ============================================================
 * NodeFM Station — Listener Playlist Submission Store
 *
 * Listener-owned immutable playlist submission proposals and
 * station-owned moderation records. Accepting a proposal forks the
 * exact submitted listener PlaylistVersion into a new station-owned
 * Playlist/PlaylistVersion. It does not alter the listener resource.
 * ============================================================ */

import type { Playlist, PlaylistVersion, PlaylistVersionTrack } from '../../../types/domain';
import {
  fetchQdnResourceData,
  publishMultipleResources,
  publishResource,
  searchQdnResources,
} from '../../../qortium/qdn';
import type { PublishMultipleResource } from '../../../qortium/qdn';
import { isConfirmedQdnNotFoundError } from '../../../qortium/qdnReadError';
import {
  createPlaylist,
  createPlaylistVersion,
  deserializePlaylistFromQdn,
  deserializePlaylistVersionFromQdn,
} from '../../playlists/services/playlistService';
import {
  getListenerPlaylistQdnIdentifier,
  getListenerPlaylistVersionQdnIdentifier,
} from './listenerPlaylistService';
import {
  addPlaylistToLocalStore,
  addPlaylistVersionToLocalStore,
  playlistPublishResource,
  playlistVersionPublishResource,
} from '../../playlists/services/playlistStore';
import { getTrackById } from '../../library/services/libraryService';
import {
  deserializeSubmissionFromQdn,
  deserializeSubmissionModerationFromQdn,
  getAcceptedSubmissionTrackId,
  getSubmissionModerationQdnIdentifier,
  getSubmissionQdnIdentifier,
  validateSubmissionStructuralIntegrity,
} from '../../listener-submissions/services/submissionService';
import {
  createListenerPlaylistSubmission,
  createListenerPlaylistSubmissionModeration,
  deserializeListenerPlaylistSubmission,
  deserializeListenerPlaylistSubmissionModeration,
  getListenerPlaylistSubmissionModerationQdnIdentifier,
  getListenerPlaylistSubmissionQdnIdentifier,
  isListenerPlaylistSubmissionIdentifier,
  isListenerPlaylistSubmissionModerationIdentifier,
  serializeListenerPlaylistSubmission,
  serializeListenerPlaylistSubmissionModeration,
  type ListenerPlaylistSubmission,
  type ListenerPlaylistSubmissionModeration as SubmissionModerationType,
} from './listenerPlaylistSubmissionService';

type StoreListener = () => void;

export type ListenerPlaylistSubmissionStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'UNRESOLVED';

export type ListenerPlaylistSubmissionReview = {
  metadata: {
    service: string;
    publisherName: string;
    identifier: string;
    created: number;
  };
  submission: ListenerPlaylistSubmission;
  status: ListenerPlaylistSubmissionStatus;
  moderation: SubmissionModerationType | null;
  moderationError?: string;
};

let reviews: ListenerPlaylistSubmissionReview[] = [];
let loaded = false;
let loading = false;
let error: string | null = null;
let incomplete = false;
let scope: string | null = null;
let epoch = 0;
let loadPromise: Promise<void> | null = null;

const listeners = new Set<StoreListener>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

function scopeKey(stationPublisherName: string, ownerAddress: string): string {
  return `${stationPublisherName.trim()}\u0000${ownerAddress.trim()}`;
}

export function subscribeToListenerPlaylistSubmissionStore(listener: StoreListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getListenerPlaylistSubmissionReviews(): ListenerPlaylistSubmissionReview[] {
  return reviews.map((review) => ({
    ...review,
    metadata: { ...review.metadata },
    submission: { ...review.submission },
    moderation: review.moderation ? { ...review.moderation } : null,
  }));
}

export function getListenerPlaylistSubmissionLoaded(): boolean {
  return loaded;
}

export function getListenerPlaylistSubmissionLoading(): boolean {
  return loading;
}

export function getListenerPlaylistSubmissionError(): string | null {
  return error;
}

export function getListenerPlaylistSubmissionIncomplete(): boolean {
  return incomplete;
}

function metadataFromResult(result: {
  name?: string;
  service?: string;
  identifier?: string;
  created?: number;
}): ListenerPlaylistSubmissionReview['metadata'] | null {
  if (
    typeof result.name !== 'string' ||
    !result.name.trim() ||
    typeof result.service !== 'string' ||
    !result.service.trim() ||
    typeof result.identifier !== 'string' ||
    !result.identifier.trim() ||
    typeof result.created !== 'number' ||
    !Number.isSafeInteger(result.created)
  ) {
    return null;
  }

  return {
    service: result.service.trim(),
    publisherName: result.name.trim(),
    identifier: result.identifier.trim(),
    created: result.created,
  };
}

export async function submitListenerPlaylist(input: {
  listenerName: string;
  listenerAddress: string;
  playlistId: string;
  playlistTitle: string;
  versionId: string;
}): Promise<ListenerPlaylistSubmission> {
  const submission = createListenerPlaylistSubmission({
    listenerName: input.listenerName,
    listenerAddress: input.listenerAddress,
    playlistId: input.playlistId,
    playlistTitle: input.playlistTitle,
    versionId: input.versionId,
    versionRef: {
      service: 'JSON',
      name: input.listenerName.trim(),
      identifier: getListenerPlaylistVersionQdnIdentifier(input.versionId),
    },
  });

  const result = await publishResource({
    service: 'JSON',
    name: input.listenerName.trim(),
    identifier: getListenerPlaylistSubmissionQdnIdentifier(submission.submissionId),
    data64: btoa(unescape(encodeURIComponent(serializeListenerPlaylistSubmission(submission)))),
    title: submission.playlistTitle,
    description: `Playlist submitted by ${submission.listenerName}`,
  });

  if (!result.accepted) {
    throw new Error('Listener playlist submission was not accepted.');
  }

  return submission;
}

async function loadReviewRecordsInternal(
  stationPublisherName: string,
  ownerAddress: string,
): Promise<{ reviews: ListenerPlaylistSubmissionReview[]; incomplete: boolean }> {
  const results = await searchQdnResources({
    service: 'JSON',
    query: 'nodefm-lp-sub-',
    prefix: true,
    mode: 'ALL',
    limit: 1000,
    includeMetadata: true,
  });

  const nextReviews: ListenerPlaylistSubmissionReview[] = [];
  let nextIncomplete = false;
  const seen = new Set<string>();

  for (const result of results) {
    const metadata = metadataFromResult(result);
    if (
      !metadata ||
      !isListenerPlaylistSubmissionIdentifier(metadata.identifier) ||
      isListenerPlaylistSubmissionModerationIdentifier(metadata.identifier)
    ) {
      continue;
    }

    const uniqueKey = `${metadata.publisherName}\u0000${metadata.identifier}`;
    if (seen.has(uniqueKey)) continue;
    seen.add(uniqueKey);

    let payload: unknown;
    try {
      payload = await fetchQdnResourceData({
        service: metadata.service,
        name: metadata.publisherName,
        identifier: metadata.identifier,
      });
    } catch (fetchError) {
      if (isConfirmedQdnNotFoundError(fetchError)) {
        continue;
      }
      nextIncomplete = true;
      continue;
    }

    const submission = deserializeListenerPlaylistSubmission(payload);
    if (
      !submission ||
      submission.submissionId !== metadata.identifier.slice('nodefm-lp-sub-'.length) ||
      submission.listenerName !== metadata.publisherName ||
      submission.versionRef.service !== 'JSON' ||
      submission.versionRef.name !== metadata.publisherName ||
      submission.versionRef.identifier !==
        getListenerPlaylistVersionQdnIdentifier(submission.versionId)
    ) {
      continue;
    }

    let moderation: SubmissionModerationType | null = null;
    let status: ListenerPlaylistSubmissionStatus = 'PENDING';
    let moderationError: string | undefined;

    try {
      const moderationPayload = await fetchQdnResourceData({
        service: 'JSON',
        name: stationPublisherName,
        identifier: getListenerPlaylistSubmissionModerationQdnIdentifier(submission.submissionId),
      });
      const parsed = deserializeListenerPlaylistSubmissionModeration(moderationPayload);

      if (!parsed || parsed.submissionId !== submission.submissionId) {
        throw new Error('Invalid station playlist moderation resource.');
      }

      if (parsed.moderatorAddress.trim() !== ownerAddress.trim()) {
        throw new Error('Station moderation resource does not match this station owner.');
      }

      moderation = parsed;
      status = parsed.decision === 'accepted' ? 'ACCEPTED' : 'REJECTED';
    } catch (moderationErrorValue) {
      if (isConfirmedQdnNotFoundError(moderationErrorValue)) {
        status = 'PENDING';
      } else {
        status = 'UNRESOLVED';
        moderationError =
          moderationErrorValue instanceof Error
            ? moderationErrorValue.message
            : 'Playlist moderation could not be resolved.';
        nextIncomplete = true;
      }
    }

    nextReviews.push({
      metadata,
      submission,
      status,
      moderation,
      moderationError,
    });
  }

  nextReviews.sort(
    (left, right) =>
      Date.parse(right.submission.submittedAt) - Date.parse(left.submission.submittedAt),
  );

  return { reviews: nextReviews, incomplete: nextIncomplete };
}

export async function loadListenerPlaylistSubmissions(
  stationPublisherName: string,
  ownerAddress: string,
  force = false,
): Promise<void> {
  const nextScope = scopeKey(stationPublisherName, ownerAddress);
  const scopeChanged = scope !== nextScope;

  if (!force && loaded && scope === nextScope) {
    return;
  }

  if (!force && loading && scope === nextScope && loadPromise) {
    return loadPromise;
  }

  epoch += 1;
  const currentEpoch = epoch;
  if (scopeChanged) {
    reviews = [];
    loaded = false;
    incomplete = false;
    error = null;
  }
  scope = nextScope;
  loading = true;
  error = null;
  incomplete = false;
  notify();

  if (!stationPublisherName.trim() || !ownerAddress.trim()) {
    loaded = true;
    loading = false;
    reviews = [];
    notify();
    return;
  }

  loadPromise = loadReviewRecordsInternal(stationPublisherName, ownerAddress)
    .then((snapshot) => {
      if (currentEpoch === epoch && scope === nextScope) {
        reviews = snapshot.reviews;
        incomplete = snapshot.incomplete;
        loaded = true;
      }
    })
    .catch((loadError) => {
      if (currentEpoch === epoch && scope === nextScope) {
        error =
          loadError instanceof Error
            ? loadError.message
            : 'Failed to load listener playlist submissions.';
      }
    })
    .finally(() => {
      if (currentEpoch === epoch && scope === nextScope) {
        loading = false;
        loadPromise = null;
        notify();
      }
    });

  return loadPromise;
}

function assertOwner(actorAddress: string | null, ownerAddress: string): void {
  if (!actorAddress || !ownerAddress || actorAddress !== ownerAddress) {
    throw new Error('Only the station owner can moderate playlist submissions.');
  }
}

async function loadExactListenerVersion(
  review: ListenerPlaylistSubmissionReview,
  stationPublisherName: string,
  ownerAddress: string,
): Promise<{
  playlist: Playlist;
  version: PlaylistVersion;
  stationTracks: PlaylistVersionTrack[];
}> {
  const submission = review.submission;

  const playlistPayload = await fetchQdnResourceData({
    service: 'PLAYLIST',
    name: submission.listenerName,
    identifier: getListenerPlaylistQdnIdentifier(submission.playlistId),
  });
  const playlist = deserializePlaylistFromQdn(playlistPayload);

  if (
    !playlist ||
    playlist.playlistId !== submission.playlistId ||
    playlist.ownerAddress.trim() !== submission.listenerAddress.trim()
  ) {
    throw new Error('Listener playlist could not be verified.');
  }

  const versionPayload = await fetchQdnResourceData({
    service: 'JSON',
    name: submission.listenerName,
    identifier: getListenerPlaylistVersionQdnIdentifier(submission.versionId),
  });
  const version = deserializePlaylistVersionFromQdn(versionPayload);

  if (
    !version ||
    version.versionId !== submission.versionId ||
    version.playlistId !== submission.playlistId
  ) {
    throw new Error('Listener PlaylistVersion could not be verified.');
  }

  const computedDuration = version.tracks.reduce((sum, track) => sum + track.durationMs, 0);
  if (
    version.totalDurationMs <= 0 ||
    version.tracks.length === 0 ||
    version.totalDurationMs !== computedDuration
  ) {
    throw new Error('Listener PlaylistVersion is invalid.');
  }

  const stationTracks: PlaylistVersionTrack[] = [];

  for (const track of version.tracks) {
    const kind = track.kind ?? 'STATION_TRACK';

    if (kind === 'STATION_TRACK') {
      const stationTrack = getTrackById(track.trackId);
      if (!stationTrack) {
        throw new Error(`Playlist track is not an approved Station Track: ${track.trackId}`);
      }

      stationTracks.push({
        trackId: track.trackId,
        durationMs: track.durationMs,
        kind: 'STATION_TRACK',
      });
      continue;
    }

    if (kind === 'OWNER_TRACK') {
      const ownerName = track.ownerName?.trim() || submission.listenerName.trim();
      if (ownerName !== submission.listenerName.trim()) {
        throw new Error('Playlist contains another listener-owned Track.');
      }

      const submissionIdentifier = getSubmissionQdnIdentifier(track.trackId);
      const submissionPayload = await fetchQdnResourceData({
        service: 'JSON',
        name: ownerName,
        identifier: submissionIdentifier,
      });
      const listenerTrackSubmission = deserializeSubmissionFromQdn(submissionPayload);

      if (!listenerTrackSubmission) {
        throw new Error(`Listener-owned Track could not be resolved: ${track.trackId}`);
      }

      const structural = validateSubmissionStructuralIntegrity(
        listenerTrackSubmission,
        ownerName,
        submissionIdentifier,
      );

      if (!structural.ok) {
        throw new Error(`Listener-owned Track is invalid: ${track.trackId}`);
      }

      if (
        listenerTrackSubmission.submitterName.trim() !== ownerName.trim() ||
        listenerTrackSubmission.submitterAddress.trim() !== submission.listenerAddress.trim()
      ) {
        throw new Error(
          `Listener-owned Track owner does not match the playlist owner: ${track.trackId}`,
        );
      }

      const stationModerationPayload = await fetchQdnResourceData({
        service: 'JSON',
        name: stationPublisherName,
        identifier: getSubmissionModerationQdnIdentifier(track.trackId),
      });

      const moderation = deserializeSubmissionModerationFromQdn(stationModerationPayload);
      if (
        !moderation ||
        moderation.submissionId !== track.trackId ||
        moderation.decision !== 'accepted' ||
        moderation.acceptedTrackId !== getAcceptedSubmissionTrackId(track.trackId) ||
        moderation.moderatorAddress.trim() !== ownerAddress.trim()
      ) {
        throw new Error(`Listener-owned Track is not station-approved: ${track.trackId}`);
      }

      const stationTrack = getTrackById(getAcceptedSubmissionTrackId(track.trackId));
      if (!stationTrack) {
        throw new Error(`Accepted Station Track is missing: ${track.trackId}`);
      }

      stationTracks.push({
        trackId: stationTrack.trackId,
        durationMs: track.durationMs,
        kind: 'STATION_TRACK',
      });
      continue;
    }

    throw new Error(`Unsupported listener playlist track kind: ${String(track.kind)}`);
  }

  return { playlist, version, stationTracks };
}

export async function acceptListenerPlaylistSubmission(
  review: ListenerPlaylistSubmissionReview,
  stationPublisherName: string,
  actorAddress: string | null,
  ownerAddress: string,
): Promise<{
  status: 'accepted' | 'already-accepted';
  playlist: Playlist;
  version: PlaylistVersion;
  moderation: SubmissionModerationType;
}> {
  assertOwner(actorAddress, ownerAddress);

  if (scope !== scopeKey(stationPublisherName, ownerAddress)) {
    throw new Error('Playlist submissions scope changed during moderation.');
  }

  if (review.status === 'ACCEPTED' && review.moderation) {
    throw new Error('This playlist submission has already been accepted.');
  }

  const { playlist: listenerPlaylist, stationTracks } = await loadExactListenerVersion(
    review,
    stationPublisherName,
    ownerAddress,
  );

  const importedPlaylist = createPlaylist({
    title: listenerPlaylist.title,
    description: listenerPlaylist.description
      ? `${listenerPlaylist.description}\n\nSubmitted by ${review.submission.listenerName}.`
      : `Submitted by ${review.submission.listenerName}.`,
    visibility: 'private',
    ownerAddress,
  });

  const versionResult = createPlaylistVersion({
    playlistId: importedPlaylist.playlistId,
    createdBy: ownerAddress,
    tracks: stationTracks,
  });

  if (!versionResult.ok) {
    throw new Error(versionResult.error);
  }

  const version = versionResult.version;
  const finalPlaylist: Playlist = {
    ...importedPlaylist,
    latestVersionId: version.versionId,
    updatedAt: new Date().toISOString(),
  };
  const moderation = createListenerPlaylistSubmissionModeration({
    moderationId: review.submission.submissionId,
    submissionId: review.submission.submissionId,
    submissionRef: {
      service: 'JSON',
      name: review.metadata.publisherName,
      identifier: review.metadata.identifier,
    },
    decision: 'accepted',
    importedPlaylistId: importedPlaylist.playlistId,
    importedVersionId: version.versionId,
    moderatorAddress: ownerAddress,
  });

  const moderationResource: PublishMultipleResource = {
    service: 'JSON',
    name: stationPublisherName.trim(),
    identifier: getListenerPlaylistSubmissionModerationQdnIdentifier(
      review.submission.submissionId,
    ),
    data64: btoa(
      unescape(encodeURIComponent(serializeListenerPlaylistSubmissionModeration(moderation))),
    ),
    title: `Playlist submission accepted: ${review.submission.playlistTitle}`,
  };

  const resources: PublishMultipleResource[] = [
    playlistVersionPublishResource(version, stationPublisherName.trim()),
    playlistPublishResource(finalPlaylist, stationPublisherName.trim()),
    moderationResource,
  ];
  const versionIdentifier = playlistVersionPublishResource(
    version,
    stationPublisherName.trim(),
  ).identifier;
  const playlistIdentifier = playlistPublishResource(
    finalPlaylist,
    stationPublisherName.trim(),
  ).identifier;
  const moderationIdentifier = moderationResource.identifier;

  const response = await publishMultipleResources(resources);
  const versionPublished = response.accepted
    ? response.published.some((entry) => entry.resource.identifier === versionIdentifier)
    : false;
  const playlistPublished = response.accepted
    ? response.published.some((entry) => entry.resource.identifier === playlistIdentifier)
    : false;
  const moderationPublished = response.accepted
    ? response.published.some((entry) => entry.resource.identifier === moderationIdentifier)
    : false;

  if (!versionPublished || !playlistPublished) {
    const versionFailure = response.failures.find(
      (entry) => entry.resource.identifier === versionIdentifier,
    );
    const playlistFailure = response.failures.find(
      (entry) => entry.resource.identifier === playlistIdentifier,
    );
    throw new Error(
      `Failed to import listener playlist: ${
        versionFailure?.error ??
        playlistFailure?.error ??
        'QDN batch publication returned an incomplete result.'
      }`,
    );
  }

  if (!moderationPublished) {
    const moderationFailure = response.failures.find(
      (entry) => entry.resource.identifier === moderationIdentifier,
    );
    throw new Error(
      `Playlist was imported, but moderation publication failed: ${
        moderationFailure?.error ??
        'QDN batch publication returned no result for the moderation record.'
      }`,
    );
  }

  addPlaylistToLocalStore(finalPlaylist);
  addPlaylistVersionToLocalStore(finalPlaylist.playlistId, version);

  if (scope === scopeKey(stationPublisherName, ownerAddress)) {
    reviews = reviews.map((entry) =>
      entry.metadata.identifier === review.metadata.identifier &&
      entry.metadata.publisherName === review.metadata.publisherName
        ? { ...entry, status: 'ACCEPTED' as const, moderation, moderationError: undefined }
        : entry,
    );
    notify();
  }

  return { status: 'accepted', playlist: finalPlaylist, version, moderation };
}

export async function rejectListenerPlaylistSubmission(
  review: ListenerPlaylistSubmissionReview,
  stationPublisherName: string,
  actorAddress: string | null,
  ownerAddress: string,
  reason?: string,
): Promise<SubmissionModerationType> {
  assertOwner(actorAddress, ownerAddress);

  if (scope !== scopeKey(stationPublisherName, ownerAddress)) {
    throw new Error('Playlist submissions scope changed during moderation.');
  }

  if (review.status === 'ACCEPTED') {
    throw new Error('Accepted playlist submissions cannot be rejected.');
  }

  const moderation = createListenerPlaylistSubmissionModeration({
    moderationId: review.submission.submissionId,
    submissionId: review.submission.submissionId,
    submissionRef: {
      service: 'JSON',
      name: review.metadata.publisherName,
      identifier: review.metadata.identifier,
    },
    decision: 'rejected',
    reason,
    moderatorAddress: ownerAddress,
  });

  await publishResource({
    service: 'JSON',
    name: stationPublisherName.trim(),
    identifier: getListenerPlaylistSubmissionModerationQdnIdentifier(
      review.submission.submissionId,
    ),
    data64: btoa(
      unescape(encodeURIComponent(serializeListenerPlaylistSubmissionModeration(moderation))),
    ),
    title: `Playlist submission rejected: ${review.submission.playlistTitle}`,
  });

  if (scope === scopeKey(stationPublisherName, ownerAddress)) {
    reviews = reviews.map((entry) =>
      entry.metadata.identifier === review.metadata.identifier &&
      entry.metadata.publisherName === review.metadata.publisherName
        ? { ...entry, status: 'REJECTED' as const, moderation, moderationError: undefined }
        : entry,
    );
    notify();
  }

  return moderation;
}

export function resetListenerPlaylistSubmissionStore(): void {
  epoch += 1;
  reviews = [];
  loaded = false;
  loading = false;
  error = null;
  incomplete = false;
  scope = null;
  loadPromise = null;
  notify();
}
