/* ============================================================
 * NodeFM Station — Playlist Service
 *
 * Domain logic for playlist management.
 * Pure functions for playlist CRUD, version creation,
 * and publication eligibility.
 * ============================================================ */

import type { Playlist, PlaylistVersion, PlaylistVersionTrack } from '../../../types/domain';
import { generateId } from '../../../utils/id';
import { isValidDurationMs, calculateTotalDurationMs } from '../../../utils/duration';
import { isRecord } from '../../../utils/record';
import { isNonEmptyTrimmedString } from '../../../utils/validation';

export const PLAYLIST_QDN_SERVICE = 'PLAYLIST';

// ── Playlist Creation ───────────────────────────────────────────────

export type CreatePlaylistInput = {
  title: string;
  description?: string;
  visibility?: 'public' | 'private';
  ownerAddress: string;
};

export function createPlaylist(input: CreatePlaylistInput): Playlist {
  if (!isNonEmptyTrimmedString(input.title)) {
    throw new Error('Playlist title must be a non-empty string.');
  }

  const visibility = input.visibility ?? 'private';

  if (!isValidPlaylistVisibility(visibility)) {
    throw new Error('Playlist visibility must be "public" or "private".');
  }

  const now = new Date().toISOString();

  return {
    schemaVersion: 1,
    playlistId: generateId(),
    ownerAddress: input.ownerAddress,
    title: input.title.trim(),
    description: input.description,
    visibility,
    latestVersionId: '',
    createdAt: now,
    updatedAt: now,
  };
}

// ── Playlist Editing ────────────────────────────────────────────────

export type EditPlaylistInput = Partial<
  Pick<Playlist, 'title' | 'description' | 'visibility' | 'cover'>
>;

export function editPlaylist(playlist: Playlist, input: EditPlaylistInput): Playlist {
  if (input.title !== undefined && !isNonEmptyTrimmedString(input.title)) {
    throw new Error('Playlist title must be a non-empty string.');
  }

  if (input.visibility !== undefined && !isValidPlaylistVisibility(input.visibility)) {
    throw new Error('Playlist visibility must be "public" or "private".');
  }

  return {
    ...playlist,
    ...input,
    title: input.title !== undefined ? input.title.trim() : playlist.title,
    updatedAt: new Date().toISOString(),
  };
}

export function duplicatePlaylist(playlist: Playlist, newTitle?: string): Playlist {
  const title = newTitle !== undefined ? newTitle : `${playlist.title} (copy)`;

  if (!isNonEmptyTrimmedString(title)) {
    throw new Error('Playlist title must be a non-empty string.');
  }

  const now = new Date().toISOString();

  return {
    ...playlist,
    playlistId: generateId(),
    title: title.trim(),
    latestVersionId: '',
    createdAt: now,
    updatedAt: now,
  };
}

// ── Playlist Version Creation ───────────────────────────────────────

export type PlaylistVersionInput = {
  playlistId: string;
  createdBy: string;
  tracks: PlaylistVersionTrack[];
  lastVersion?: PlaylistVersion;
};

/**
 * Create an immutable playlist version.
 * Validates that every track has a valid duration.
 * Returns error if any track has invalid duration.
 */
export function createPlaylistVersion(
  input: PlaylistVersionInput,
):
  { ok: true; version: PlaylistVersion } | { ok: false; error: string; invalidTrackIds: string[] } {
  if (input.tracks.length === 0) {
    return {
      ok: false,
      error: 'Playlist version requires at least one track.',
      invalidTrackIds: [],
    };
  }

  const invalidTrackIds: string[] = [];

  for (const track of input.tracks) {
    if (!isValidPlaylistVersionTrack(track)) {
      invalidTrackIds.push(getPlaylistVersionTrackLabel(track));
    }
  }

  if (invalidTrackIds.length > 0) {
    return {
      ok: false,
      error: `Playlist contains ${invalidTrackIds.length} invalid track(s).`,
      invalidTrackIds,
    };
  }

  const totalDurationMs = calculateTotalDurationMs(
    input.tracks.filter(isValidPlaylistVersionTrack).map((t) => t.durationMs),
  );

  const versionNumber = input.lastVersion ? input.lastVersion.versionNumber + 1 : 1;

  const version: PlaylistVersion = {
    schemaVersion: 1,
    playlistId: input.playlistId,
    versionId: generateId(),
    versionNumber,
    createdBy: input.createdBy,
    createdAt: new Date().toISOString(),
    tracks: input.tracks.map((track) => ({ ...track })),
    totalDurationMs,
  };

  return { ok: true, version };
}

// ── Publication Eligibility ─────────────────────────────────────────

export function isPlaylistPublishable(tracks: PlaylistVersionTrack[]): {
  publishable: boolean;
  reason?: string;
  invalidTrackIds: string[];
} {
  const invalidTrackIds: string[] = [];

  for (const track of tracks) {
    if (!isValidPlaylistVersionTrack(track)) {
      invalidTrackIds.push(getPlaylistVersionTrackLabel(track));
    }
  }

  if (invalidTrackIds.length > 0) {
    return {
      publishable: false,
      reason: `${invalidTrackIds.length} track(s) are invalid.`,
      invalidTrackIds,
    };
  }

  if (tracks.length === 0) {
    return {
      publishable: false,
      reason: 'Playlist has no tracks.',
      invalidTrackIds: [],
    };
  }

  return { publishable: true, invalidTrackIds: [] };
}

// ── Track Snapshot ──────────────────────────────────────────────────

/**
 * Create an ordered track snapshot from track data.
 * Preserves exact order and captures trackId + durationMs.
 */
export function createTrackSnapshot(
  tracks: Array<{ trackId: string; durationMs: number }>,
): PlaylistVersionTrack[] {
  return tracks.map(({ trackId, durationMs }) => {
    if (!isNonEmptyTrimmedString(trackId)) {
      throw new Error('Playlist track snapshot requires a non-empty trackId.');
    }

    return {
      trackId,
      durationMs,
    };
  });
}

export function isValidPlaylistVisibility(value: unknown): value is 'public' | 'private' {
  return value === 'public' || value === 'private';
}

export function isValidPlaylistVersionTrack(value: unknown): value is PlaylistVersionTrack {
  return (
    isRecord(value) && isNonEmptyTrimmedString(value.trackId) && isValidDurationMs(value.durationMs)
  );
}

function getPlaylistVersionTrackLabel(value: unknown): string {
  if (isRecord(value) && isNonEmptyTrimmedString(value.trackId)) {
    return value.trackId;
  }

  return '<unknown>';
}

// ── QDN Identity Helpers ────────────────────────────────────────────
//
// QDN resource identity lives in the `identifier` field.
// The `name` field is the publisher's registered Qortium name.

export function getPlaylistQdnIdentifier(playlistId: string): string {
  return `nodefm-playlist-${playlistId}`;
}

export function getPlaylistVersionQdnIdentifier(versionId: string): string {
  return `nodefm-playlist-version-${versionId}`;
}

// ── Serialization ───────────────────────────────────────────────────

export function serializePlaylistForQdn(playlist: Playlist): string {
  return JSON.stringify(playlist);
}

export function deserializePlaylistFromQdn(value: unknown): Playlist | null {
  if (!isRecord(value)) {
    return null;
  }

  const parsed = value as unknown as Playlist;

  if (
    typeof parsed.playlistId !== 'string' ||
    typeof parsed.ownerAddress !== 'string' ||
    !isNonEmptyTrimmedString(parsed.title) ||
    !isValidPlaylistVisibility(parsed.visibility)
  ) {
    return null;
  }

  return parsed;
}

export function serializePlaylistVersionForQdn(version: PlaylistVersion): string {
  return JSON.stringify(version);
}

export function deserializePlaylistVersionFromQdn(value: unknown): PlaylistVersion | null {
  if (!isRecord(value)) {
    return null;
  }

  const parsed = value as unknown as PlaylistVersion;

  if (
    typeof parsed.versionId !== 'string' ||
    typeof parsed.playlistId !== 'string' ||
    !Array.isArray(parsed.tracks)
  ) {
    return null;
  }

  if (!parsed.tracks.every(isValidPlaylistVersionTrack)) {
    return null;
  }

  return parsed;
}
