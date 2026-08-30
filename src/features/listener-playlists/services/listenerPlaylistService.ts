/* ============================================================
 * NodeFM Station — Listener Playlist Domain Service
 *
 * Role-neutral playlist authoring rules reused by listener-owned
 * playlists. Published listener playlists use the same immutable
 * PlaylistVersion semantics as station playlists; this file adds only
 * the draft-entry model and publication gate required by the
 * listener-owned workflow.
 * ============================================================ */

import { generateId } from '../../../utils/id';
import { isNonEmptyTrimmedString } from '../../../utils/validation';
import { isValidDurationMs } from '../../../utils/duration';
import { isRecord } from '../../../utils/record';
import { shuffleArray, rotateArray } from '../../../utils/deterministicShuffle';
import {
  createPlaylist,
  createPlaylistVersion,
  editPlaylist,
  type CreatePlaylistInput,
  type EditPlaylistInput,
  type PlaylistVersionInput,
} from '../../playlists/services/playlistService';
import type {
  Playlist,
  PlaylistVersion,
  PlaylistVersionTrack,
  PlaylistVisibility,
} from '../../../types/domain';

export const LISTENER_PLAYLIST_QDN_SERVICE = 'PLAYLIST';
export const LISTENER_PLAYLIST_IDENTIFIER_PREFIX = 'nodefm-listener-playlist-';
export const LISTENER_PLAYLIST_VERSION_IDENTIFIER_PREFIX = 'nodefm-lp-ver-';

export type ListenerPlaylistDraftEntry =
  | {
      entryId: string;
      kind: 'canonical-track';
      trackId: string;
      durationMs: number;
      title: string;
      artist?: string;
    }
  | {
      entryId: string;
      kind: 'pending-submission';
      submissionId: string;
      durationMs: number;
      title: string;
      artist?: string;
    };

export type ListenerPlaylistDraft = {
  playlistId: string;
  title: string;
  description?: string;
  visibility?: PlaylistVisibility;
  ownerAddress: string;
  ownerName: string;
  entries: ListenerPlaylistDraftEntry[];
  createdAt: string;
  updatedAt: string;
};

export type ListenerSubmissionResolutionStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'UNRESOLVED';

export type ListenerSubmissionResolution = {
  submissionId: string;
  status: ListenerSubmissionResolutionStatus;
  acceptedTrackId?: string;
  title: string;
  artist?: string;
  durationMs: number;
};

export type ResolvedListenerDraftEntry =
  | {
      entryId: string;
      kind: 'canonical-track';
      trackId: string;
      durationMs: number;
      title: string;
      artist?: string;
      status: 'READY';
    }
  | {
      entryId: string;
      kind: 'pending-submission';
      trackId: string;
      durationMs: number;
      title: string;
      artist?: string;
      stationStatus: ListenerSubmissionResolutionStatus;
      acceptedTrackId?: string;
    };

export type ListenerDraftPublicationResult =
  | {
      publishable: true;
      tracks: PlaylistVersionTrack[];
    }
  | {
      publishable: false;
      reason: string;
      pendingSubmissionCount: number;
      rejectedSubmissionCount: number;
      unresolvedSubmissionCount: number;
      tracks: PlaylistVersionTrack[];
    };

export type ListenerStationSubmissionResult =
  | {
      eligible: true;
      stationTracks: PlaylistVersionTrack[];
    }
  | {
      eligible: false;
      reason: string;
      pendingSubmissionCount: number;
      rejectedSubmissionCount: number;
      unresolvedSubmissionCount: number;
      stationTracks: PlaylistVersionTrack[];
    };

export function isListenerPlaylistDraftEntry(value: unknown): value is ListenerPlaylistDraftEntry {
  if (!isRecord(value) || !isNonEmptyTrimmedString(value.entryId)) {
    return false;
  }

  if (value.kind === 'canonical-track') {
    return (
      isNonEmptyTrimmedString(value.trackId) &&
      isValidDurationMs(value.durationMs) &&
      isNonEmptyTrimmedString(value.title) &&
      (value.artist === undefined || typeof value.artist === 'string')
    );
  }

  if (value.kind === 'pending-submission') {
    return (
      isNonEmptyTrimmedString(value.submissionId) &&
      isValidDurationMs(value.durationMs) &&
      isNonEmptyTrimmedString(value.title) &&
      (value.artist === undefined || typeof value.artist === 'string')
    );
  }

  return false;
}

export function isListenerPlaylistDraft(value: unknown): value is ListenerPlaylistDraft {
  if (!isRecord(value)) {
    return false;
  }

  const candidate = value as unknown as ListenerPlaylistDraft;

  return (
    isNonEmptyTrimmedString(candidate.playlistId) &&
    typeof candidate.title === 'string' &&
    isNonEmptyTrimmedString(candidate.ownerAddress) &&
    isNonEmptyTrimmedString(candidate.ownerName) &&
    Array.isArray(candidate.entries) &&
    candidate.entries.every(isListenerPlaylistDraftEntry)
  );
}

export type CreateListenerPlaylistDraftInput = {
  playlistId?: string;
  title: string;
  description?: string;
  visibility?: PlaylistVisibility;
  ownerAddress: string;
  ownerName: string;
  entries?: ListenerPlaylistDraftEntry[];
};

export function createListenerPlaylistDraft(
  input: CreateListenerPlaylistDraftInput,
): ListenerPlaylistDraft {
  if (!isNonEmptyTrimmedString(input.ownerName)) {
    throw new Error('A registered Qortium name is required to create a listener playlist.');
  }

  if (!isNonEmptyTrimmedString(input.ownerAddress)) {
    throw new Error('An authenticated account is required to create a listener playlist.');
  }

  const now = new Date().toISOString();

  return {
    playlistId: input.playlistId?.trim() || generateId(),
    title: input.title.trim(),
    description: input.description?.trim() || undefined,
    visibility: input.visibility ?? 'private',
    ownerAddress: input.ownerAddress.trim(),
    ownerName: input.ownerName.trim(),
    entries: input.entries ? input.entries.map(cloneListenerDraftEntry) : [],
    createdAt: now,
    updatedAt: now,
  };
}

export function editListenerPlaylistDraft(
  draft: ListenerPlaylistDraft,
  input: Pick<EditPlaylistInput, 'title' | 'description' | 'visibility'>,
): ListenerPlaylistDraft {
  const edited = editPlaylist(toDraftPlaylist(draft), input);

  return {
    ...draft,
    title: edited.title,
    description: edited.description,
    visibility: edited.visibility,
    updatedAt: new Date().toISOString(),
  };
}

export function addCanonicalTracksToListenerDraft(
  draft: ListenerPlaylistDraft,
  tracks: ReadonlyArray<{ trackId: string; durationMs: number; title: string; artist?: string }>,
  options: { avoidDuplicates?: boolean } = {},
): ListenerPlaylistDraft {
  const next = cloneListenerDraft(draft);
  const avoidDuplicates = options.avoidDuplicates ?? true;

  for (const track of tracks) {
    if (
      !isNonEmptyTrimmedString(track.trackId) ||
      !isValidDurationMs(track.durationMs) ||
      !isNonEmptyTrimmedString(track.title)
    ) {
      throw new Error('Canonical track entries require trackId, durationMs, and title.');
    }

    if (
      avoidDuplicates &&
      next.entries.some(
        (entry) => entry.kind === 'canonical-track' && entry.trackId === track.trackId,
      )
    ) {
      continue;
    }

    next.entries.push({
      entryId: generateId(),
      kind: 'canonical-track',
      trackId: track.trackId.trim(),
      durationMs: track.durationMs,
      title: track.title.trim(),
      artist: track.artist?.trim() || undefined,
    });
  }

  next.updatedAt = new Date().toISOString();
  return next;
}

export function addPendingSubmissionToListenerDraft(
  draft: ListenerPlaylistDraft,
  submission: {
    submissionId: string;
    durationMs: number;
    title: string;
    artist?: string;
  },
): ListenerPlaylistDraft {
  if (
    !isNonEmptyTrimmedString(submission.submissionId) ||
    !isValidDurationMs(submission.durationMs) ||
    !isNonEmptyTrimmedString(submission.title)
  ) {
    throw new Error('Pending submission entries require submissionId, durationMs, and title.');
  }

  const next = cloneListenerDraft(draft);
  const existing = next.entries.find(
    (entry) =>
      entry.kind === 'pending-submission' && entry.submissionId === submission.submissionId,
  );

  if (existing) {
    return next;
  }

  next.entries.push({
    entryId: generateId(),
    kind: 'pending-submission',
    submissionId: submission.submissionId.trim(),
    durationMs: submission.durationMs,
    title: submission.title.trim(),
    artist: submission.artist?.trim() || undefined,
  });
  next.updatedAt = new Date().toISOString();
  return next;
}

/**
 * Semantic alias for the listener-owned Track path. The backing draft entry
 * remains backward-compatible with the legacy `pending-submission` shape.
 */
export function addOwnerTrackToListenerDraft(
  draft: ListenerPlaylistDraft,
  track: {
    submissionId: string;
    durationMs: number;
    title: string;
    artist?: string;
  },
): ListenerPlaylistDraft {
  return addPendingSubmissionToListenerDraft(draft, track);
}

export function removeListenerDraftEntry(
  draft: ListenerPlaylistDraft,
  entryId: string,
): ListenerPlaylistDraft {
  const next = cloneListenerDraft(draft);
  next.entries = next.entries.filter((entry) => entry.entryId !== entryId);
  next.updatedAt = new Date().toISOString();
  return next;
}

export function reorderListenerDraftEntry(
  draft: ListenerPlaylistDraft,
  entryId: string,
  targetIndex: number,
): ListenerPlaylistDraft {
  const sourceIndex = draft.entries.findIndex((entry) => entry.entryId === entryId);
  if (sourceIndex === -1) {
    return cloneListenerDraft(draft);
  }

  const entries = [...draft.entries];
  const [moved] = entries.splice(sourceIndex, 1);
  const boundedIndex = Math.max(0, Math.min(targetIndex, entries.length));
  entries.splice(boundedIndex, 0, moved);

  return {
    ...draft,
    entries,
    updatedAt: new Date().toISOString(),
  };
}

export function shuffleListenerDraft(draft: ListenerPlaylistDraft): ListenerPlaylistDraft {
  return {
    ...draft,
    entries: shuffleArray(draft.entries),
    updatedAt: new Date().toISOString(),
  };
}

export function rotateListenerDraftStart(draft: ListenerPlaylistDraft): ListenerPlaylistDraft {
  return {
    ...draft,
    entries: rotateArray(draft.entries, 1),
    updatedAt: new Date().toISOString(),
  };
}

export function resolveListenerDraftEntries(
  draft: ListenerPlaylistDraft,
  resolutions: readonly ListenerSubmissionResolution[],
): ResolvedListenerDraftEntry[] {
  const bySubmission = new Map(
    resolutions.map((resolution) => [resolution.submissionId, resolution]),
  );

  return draft.entries.map((entry) => {
    if (entry.kind === 'canonical-track') {
      return {
        entryId: entry.entryId,
        kind: 'canonical-track' as const,
        trackId: entry.trackId,
        durationMs: entry.durationMs,
        title: entry.title,
        artist: entry.artist,
        status: 'READY' as const,
      };
    }

    const resolution = bySubmission.get(entry.submissionId);

    if (!resolution) {
      return {
        entryId: entry.entryId,
        kind: 'pending-submission' as const,
        trackId: entry.submissionId,
        durationMs: entry.durationMs,
        title: entry.title,
        artist: entry.artist,
        stationStatus: 'UNRESOLVED' as const,
      };
    }

    if (resolution.status === 'ACCEPTED' && resolution.acceptedTrackId) {
      return {
        entryId: entry.entryId,
        kind: 'pending-submission' as const,
        trackId: entry.submissionId,
        durationMs: entry.durationMs,
        title: entry.title,
        artist: entry.artist,
        stationStatus: 'ACCEPTED' as const,
        acceptedTrackId: resolution.acceptedTrackId,
      };
    }

    if (resolution.status === 'REJECTED') {
      return {
        entryId: entry.entryId,
        kind: 'pending-submission' as const,
        trackId: entry.submissionId,
        durationMs: entry.durationMs,
        title: entry.title,
        artist: entry.artist,
        stationStatus: 'REJECTED' as const,
      };
    }

    return {
      entryId: entry.entryId,
      kind: 'pending-submission' as const,
      trackId: entry.submissionId,
      durationMs: entry.durationMs,
      title: entry.title,
      artist: entry.artist,
      stationStatus: 'PENDING' as const,
    };
  });
}

export function evaluateListenerDraftPublication(
  draft: ListenerPlaylistDraft,
  resolutions: readonly ListenerSubmissionResolution[],
): ListenerDraftPublicationResult {
  const resolved = resolveListenerDraftEntries(draft, resolutions);
  const tracks: PlaylistVersionTrack[] = [];
  let pendingSubmissionCount = 0;
  let rejectedSubmissionCount = 0;
  let unresolvedSubmissionCount = 0;

  for (const entry of resolved) {
    if (entry.kind === 'canonical-track') {
      tracks.push({
        trackId: entry.trackId,
        durationMs: entry.durationMs,
        kind: 'STATION_TRACK',
      });
      continue;
    }

    if (entry.stationStatus === 'PENDING') {
      pendingSubmissionCount += 1;
    } else if (entry.stationStatus === 'REJECTED') {
      rejectedSubmissionCount += 1;
    } else if (entry.stationStatus === 'UNRESOLVED') {
      unresolvedSubmissionCount += 1;
    }

    // Listener ownership grants immediate personal use. The immutable
    // PlaylistVersion records the owner-track reference, never a pending
    // placeholder or a later station acceptedTrackId.
    tracks.push({
      trackId: entry.trackId,
      durationMs: entry.durationMs,
      kind: 'OWNER_TRACK',
      ownerName: draft.ownerName,
    });
  }

  if (tracks.length === 0) {
    return {
      publishable: false,
      reason: 'Playlist has no tracks.',
      pendingSubmissionCount,
      rejectedSubmissionCount,
      unresolvedSubmissionCount,
      tracks,
    };
  }

  return {
    publishable: true,
    tracks,
  };
}

export function evaluateListenerDraftStationSubmission(
  draft: ListenerPlaylistDraft,
  resolutions: readonly ListenerSubmissionResolution[],
): ListenerStationSubmissionResult {
  const resolved = resolveListenerDraftEntries(draft, resolutions);
  const stationTracks: PlaylistVersionTrack[] = [];
  let pendingSubmissionCount = 0;
  let rejectedSubmissionCount = 0;
  let unresolvedSubmissionCount = 0;

  for (const entry of resolved) {
    if (entry.kind === 'canonical-track') {
      stationTracks.push({
        trackId: entry.trackId,
        durationMs: entry.durationMs,
        kind: 'STATION_TRACK',
      });
      continue;
    }

    if (entry.stationStatus === 'ACCEPTED' && entry.acceptedTrackId) {
      stationTracks.push({
        trackId: entry.acceptedTrackId,
        durationMs: entry.durationMs,
        kind: 'STATION_TRACK',
      });
      continue;
    }

    if (entry.stationStatus === 'PENDING') {
      pendingSubmissionCount += 1;
    } else if (entry.stationStatus === 'REJECTED') {
      rejectedSubmissionCount += 1;
    } else {
      unresolvedSubmissionCount += 1;
    }
  }

  if (stationTracks.length === 0) {
    return {
      eligible: false,
      reason: 'Playlist has no station-eligible tracks.',
      pendingSubmissionCount,
      rejectedSubmissionCount,
      unresolvedSubmissionCount,
      stationTracks,
    };
  }

  if (pendingSubmissionCount > 0 || rejectedSubmissionCount > 0 || unresolvedSubmissionCount > 0) {
    const reasons: string[] = [];
    if (pendingSubmissionCount > 0) {
      reasons.push(
        `${pendingSubmissionCount} track${pendingSubmissionCount === 1 ? '' : 's'} still awaiting station approval`,
      );
    }
    if (rejectedSubmissionCount > 0) {
      reasons.push(
        `${rejectedSubmissionCount} track${rejectedSubmissionCount === 1 ? '' : 's'} not approved for station use`,
      );
    }
    if (unresolvedSubmissionCount > 0) {
      reasons.push(
        `${unresolvedSubmissionCount} track${unresolvedSubmissionCount === 1 ? '' : 's'} could not be verified`,
      );
    }

    return {
      eligible: false,
      reason: reasons.join(', '),
      pendingSubmissionCount,
      rejectedSubmissionCount,
      unresolvedSubmissionCount,
      stationTracks,
    };
  }

  return {
    eligible: true,
    stationTracks,
  };
}

export function createListenerPlaylistVersionFromDraft(
  draft: ListenerPlaylistDraft,
  tracks: PlaylistVersionTrack[],
  lastVersion?: PlaylistVersion,
): ReturnType<typeof createPlaylistVersion> {
  const input: PlaylistVersionInput = {
    playlistId: draft.playlistId,
    createdBy: draft.ownerAddress,
    tracks,
    lastVersion,
  };

  return createPlaylistVersion(input);
}

/**
 * The publishable title for a listener playlist.
 *
 * Create mode intentionally initializes an empty draft title so the editor
 * can render safely before the listener has entered metadata. Publication is
 * allowed with that empty title and the logical Playlist resource falls back
 * to the same visible default used by the editor.
 */
export function getListenerPlaylistDisplayTitle(draft: ListenerPlaylistDraft): string {
  return draft.title.trim() || 'Untitled Playlist';
}

export function toListenerPlaylist(
  draft: ListenerPlaylistDraft,
  latestVersionId = '',
  visibility: 'public' | 'private' = 'private',
): Playlist {
  const playlistVisibility = draft.visibility ?? visibility;

  const input: CreatePlaylistInput = {
    title: getListenerPlaylistDisplayTitle(draft),
    description: draft.description,
    visibility: playlistVisibility,
    ownerAddress: draft.ownerAddress,
  };

  const playlist = createPlaylist(input);

  return {
    ...playlist,
    playlistId: draft.playlistId,
    latestVersionId,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
  };
}

export function toDraftPlaylist(draft: ListenerPlaylistDraft): Playlist {
  return toListenerPlaylist(draft);
}

export function getListenerPlaylistQdnIdentifier(playlistId: string): string {
  if (!isNonEmptyTrimmedString(playlistId)) {
    throw new Error('Playlist ID is required to build a QDN identifier.');
  }

  const identifier = `${LISTENER_PLAYLIST_IDENTIFIER_PREFIX}${playlistId.trim()}`;
  if (identifier.length > 64) {
    throw new Error('QDN identifier exceeds 64 bytes.');
  }

  return identifier;
}

export function getListenerPlaylistVersionQdnIdentifier(versionId: string): string {
  if (!isNonEmptyTrimmedString(versionId)) {
    throw new Error('Version ID is required to build a QDN identifier.');
  }

  const identifier = `${LISTENER_PLAYLIST_VERSION_IDENTIFIER_PREFIX}${versionId.trim()}`;
  if (identifier.length > 64) {
    throw new Error('QDN identifier exceeds 64 bytes.');
  }

  return identifier;
}

export function cloneListenerDraft(draft: ListenerPlaylistDraft): ListenerPlaylistDraft {
  return {
    ...draft,
    entries: draft.entries.map(cloneListenerDraftEntry),
  };
}

export function cloneListenerDraftEntry(
  entry: ListenerPlaylistDraftEntry,
): ListenerPlaylistDraftEntry {
  return {
    ...entry,
  };
}
