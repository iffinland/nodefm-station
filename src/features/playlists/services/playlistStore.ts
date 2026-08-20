/* ============================================================
 * NodeFM Station — Playlist Store
 *
 * In-memory playlist store with QDN persistence.
 * Manages mutable Playlists and immutable PlaylistVersions.
 * ============================================================ */

import type { Playlist, PlaylistVersion } from '../../../types/domain';
import {
  publishResource,
  fetchQdnResourceData,
  searchQdnResources,
  deleteQdnResource,
} from '../../../qortium/qdn';
import {
  createPlaylist,
  editPlaylist,
  duplicatePlaylist,
  createPlaylistVersion,
  getPlaylistQdnIdentifier,
  getPlaylistVersionQdnIdentifier,
  serializePlaylistForQdn,
  deserializePlaylistFromQdn,
  serializePlaylistVersionForQdn,
  deserializePlaylistVersionFromQdn,
  type CreatePlaylistInput,
  type EditPlaylistInput,
  type PlaylistVersionInput,
} from './playlistService';
import {
  collectPlaylistVersionReferences,
  PlaylistVersionReferencedError,
} from './playlistVersionReferenceService';
import {
  getQdnResourceReadErrorCode,
  isConfirmedQdnNotFoundError,
} from '../../../qortium/qdnReadError';

// ── In-Memory Store ─────────────────────────────────────────────────

let playlists: Playlist[] = [];
let playlistVersions: Map<string, PlaylistVersion[]> = new Map();
let storeLoaded = false;
let storeLoading = false;
let storeError: string | null = null;
let storeIncomplete = false;
let storeDiagnostics: PlaylistStoreDiagnostic[] = [];
let storeEpoch = 0;
let storeActiveScope: string | null = null;

type StoreListener = () => void;
const listeners = new Set<StoreListener>();

export type PlaylistStoreDiagnosticCode =
  | 'INVALID_METADATA'
  | 'MALFORMED_RESOURCE'
  | 'RESOURCE_UNAVAILABLE'
  | 'RESOURCE_NOT_FOUND'
  | 'IDENTITY_MISMATCH';

export type PlaylistStoreDiagnostic = {
  identifier: string;
  kind: 'playlist' | 'version';
  code: PlaylistStoreDiagnosticCode;
  detail: string;
};

function notify() {
  listeners.forEach((fn) => fn());
}

function storeScopeKey(ownerName: string, ownerAddress: string): string {
  return `${ownerAddress}\u0000${ownerName}`;
}

// ── Persistence ─────────────────────────────────────────────────────

const PLAYLIST_SERVICE = 'PLAYLIST';
const VERSION_SERVICE = 'JSON';
const PLAYLIST_IDENTIFIER_PREFIX = 'nodefm-playlist-';
const VERSION_IDENTIFIER_PREFIX = 'nodefm-playlist-version-';

async function persistPlaylist(playlist: Playlist, ownerName: string): Promise<void> {
  const json = serializePlaylistForQdn(playlist);
  const base64 = btoa(unescape(encodeURIComponent(json)));

  await publishResource({
    service: PLAYLIST_SERVICE,
    name: ownerName,
    identifier: getPlaylistQdnIdentifier(playlist.playlistId),
    data64: base64,
    title: playlist.title,
    description: playlist.description,
  });
}

async function persistPlaylistVersion(version: PlaylistVersion, ownerName: string): Promise<void> {
  const json = serializePlaylistVersionForQdn(version);
  const base64 = btoa(unescape(encodeURIComponent(json)));

  await publishResource({
    service: VERSION_SERVICE,
    name: ownerName,
    identifier: getPlaylistVersionQdnIdentifier(version.versionId),
    data64: base64,
    title: `Version ${version.versionNumber}`,
  });
}

// ── Subscriptions ───────────────────────────────────────────────────

export function subscribeToPlaylistStore(onChange: StoreListener): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

// ── Getters ─────────────────────────────────────────────────────────

export function getPlaylists(): Playlist[] {
  return [...playlists];
}

export function getPlaylistById(playlistId: string): Playlist | undefined {
  return playlists.find((p) => p.playlistId === playlistId);
}

export function getPlaylistVersions(playlistId: string): PlaylistVersion[] {
  return [...(playlistVersions.get(playlistId) ?? [])];
}

export function getLatestPlaylistVersion(playlistId: string): PlaylistVersion | undefined {
  const versions = playlistVersions.get(playlistId);
  if (!versions || versions.length === 0) return undefined;
  return versions[versions.length - 1];
}

export function getStoreLoaded(): boolean {
  return storeLoaded;
}

export function getStoreLoading(): boolean {
  return storeLoading;
}

export function getStoreError(): string | null {
  return storeError;
}

export function getStoreIncomplete(): boolean {
  return storeIncomplete;
}

export function getStoreDiagnostics(): PlaylistStoreDiagnostic[] {
  return [...storeDiagnostics];
}

export function getStoreActiveScope(): string | null {
  return storeActiveScope;
}

export function isStoreCurrentScope(ownerName: string, ownerAddress: string): boolean {
  return storeActiveScope === storeScopeKey(ownerName, ownerAddress);
}

export type StoreLoadAction = 'clear' | 'reuse' | 'load';

/**
 * Decide whether a hook mount should clear state, reuse the already-loaded
 * account-scoped state, or start a fresh load. See the equivalent
 * `getLibraryLoadAction` for the account-isolation rationale.
 */
export function getStoreLoadAction(
  ownerName: string | null,
  ownerAddress: string | null,
): StoreLoadAction {
  if (!ownerName || !ownerAddress) {
    return 'clear';
  }

  if (isStoreCurrentScope(ownerName, ownerAddress) && (storeLoaded || storeLoading)) {
    return 'reuse';
  }

  return 'load';
}

// ── Load ────────────────────────────────────────────────────────────

export async function loadPlaylistStore(ownerName: string, ownerAddress: string): Promise<void> {
  if (storeLoaded || storeLoading) return;

  const targetScope = storeScopeKey(ownerName, ownerAddress);
  const epoch = storeEpoch;

  storeActiveScope = targetScope;
  storeLoading = true;
  storeError = null;
  notify();

  try {
    // Load playlists — search by identifier prefix under the owner's name
    const playlistResults = await searchQdnResources({
      service: PLAYLIST_SERVICE,
      name: ownerName,
      query: PLAYLIST_IDENTIFIER_PREFIX,
      prefix: true,
      limit: 500,
      includeMetadata: true,
    });

    const loaded: Playlist[] = [];
    const diagnostics: PlaylistStoreDiagnostic[] = [];
    const seenPlaylistIdentifiers = new Set<string>();
    let incomplete = false;

    for (const result of playlistResults) {
      if (!result.identifier || !result.identifier.startsWith(PLAYLIST_IDENTIFIER_PREFIX)) continue;
      // Skip version identifiers that happen to share the prefix
      if (result.identifier.startsWith(VERSION_IDENTIFIER_PREFIX)) continue;
      if (seenPlaylistIdentifiers.has(result.identifier)) continue;

      const identifier = result.identifier;

      try {
        const payload = await fetchQdnResourceData({
          service: PLAYLIST_SERVICE,
          name: ownerName,
          identifier,
        });
        const playlist = deserializePlaylistFromQdn(payload);

        if (!playlist) {
          diagnostics.push({
            identifier,
            kind: 'playlist',
            code: 'MALFORMED_RESOURCE',
            detail: 'Logical playlist resource is malformed.',
          });
          incomplete = true;
          continue;
        }

        if (playlist.ownerAddress !== ownerAddress) {
          diagnostics.push({
            identifier,
            kind: 'playlist',
            code: 'IDENTITY_MISMATCH',
            detail: 'Playlist owner does not match the station owner.',
          });
          incomplete = true;
          continue;
        }

        seenPlaylistIdentifiers.add(identifier);
        loaded.push(playlist);
      } catch (error) {
        if (isConfirmedQdnNotFoundError(error)) {
          diagnostics.push({
            identifier,
            kind: 'playlist',
            code: 'RESOURCE_NOT_FOUND',
            detail: error instanceof Error ? error.message : 'Playlist resource was not found.',
          });
          continue;
        }

        const code = getQdnResourceReadErrorCode(error);
        diagnostics.push({
          identifier,
          kind: 'playlist',
          code: code === 'MALFORMED' ? 'MALFORMED_RESOURCE' : 'RESOURCE_UNAVAILABLE',
          detail: error instanceof Error ? error.message : 'Playlist resource could not be loaded.',
        });
        incomplete = true;
      }
    }

    if (epoch !== storeEpoch || storeActiveScope !== targetScope) {
      return;
    }

    playlists = loaded;

    // Load versions for each playlist
    const versionMap = new Map<string, PlaylistVersion[]>();
    const seenVersionIdentifiers = new Set<string>();

    const versionResults = await searchQdnResources({
      service: VERSION_SERVICE,
      name: ownerName,
      query: VERSION_IDENTIFIER_PREFIX,
      prefix: true,
      limit: 1000,
      includeMetadata: true,
    });

    for (const result of versionResults) {
      if (!result.identifier || !result.identifier.startsWith(VERSION_IDENTIFIER_PREFIX)) continue;
      if (seenVersionIdentifiers.has(result.identifier)) continue;

      const identifier = result.identifier;

      try {
        const payload = await fetchQdnResourceData({
          service: VERSION_SERVICE,
          name: ownerName,
          identifier,
        });
        const version = deserializePlaylistVersionFromQdn(payload);

        if (!version) {
          diagnostics.push({
            identifier,
            kind: 'version',
            code: 'MALFORMED_RESOURCE',
            detail: 'Playlist version resource is malformed.',
          });
          incomplete = true;
          continue;
        }

        seenVersionIdentifiers.add(identifier);
        const existing = versionMap.get(version.playlistId) ?? [];
        existing.push(version);
        versionMap.set(version.playlistId, existing);
      } catch (error) {
        if (isConfirmedQdnNotFoundError(error)) {
          diagnostics.push({
            identifier,
            kind: 'version',
            code: 'RESOURCE_NOT_FOUND',
            detail: error instanceof Error ? error.message : 'Version resource was not found.',
          });
          continue;
        }

        const code = getQdnResourceReadErrorCode(error);
        diagnostics.push({
          identifier,
          kind: 'version',
          code: code === 'MALFORMED' ? 'MALFORMED_RESOURCE' : 'RESOURCE_UNAVAILABLE',
          detail: error instanceof Error ? error.message : 'Version resource could not be loaded.',
        });
        incomplete = true;
      }
    }

    // Sort versions by versionNumber
    for (const [, versions] of versionMap) {
      versions.sort((a, b) => a.versionNumber - b.versionNumber);
    }

    if (epoch !== storeEpoch || storeActiveScope !== targetScope) {
      return;
    }

    playlistVersions = versionMap;
    storeDiagnostics = diagnostics;
    storeIncomplete = incomplete;
    storeLoaded = true;
  } catch (error) {
    if (epoch !== storeEpoch || storeActiveScope !== targetScope) {
      return;
    }

    storeError = error instanceof Error ? error.message : 'Failed to load playlists.';
  } finally {
    if (epoch === storeEpoch) {
      storeLoading = false;
      notify();
    }
  }
}

// ── Playlist CRUD ───────────────────────────────────────────────────

export async function addPlaylist(
  input: CreatePlaylistInput,
  ownerName: string,
): Promise<Playlist> {
  const playlist = createPlaylist(input);

  try {
    await persistPlaylist(playlist, ownerName);
  } catch (error) {
    throw new Error(
      `Failed to publish playlist: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }

  playlists = [...playlists, playlist];
  notify();
  return playlist;
}

export async function updatePlaylist(
  playlistId: string,
  input: EditPlaylistInput,
  ownerName: string,
): Promise<Playlist> {
  const index = playlists.findIndex((p) => p.playlistId === playlistId);
  if (index === -1) throw new Error(`Playlist not found: ${playlistId}`);

  const updated = editPlaylist(playlists[index], input);

  try {
    await persistPlaylist(updated, ownerName);
  } catch (error) {
    throw new Error(
      `Failed to update playlist: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }

  playlists = [...playlists.slice(0, index), updated, ...playlists.slice(index + 1)];
  notify();
  return updated;
}

export async function duplicatePlaylistAction(
  playlistId: string,
  newTitle: string | undefined,
  ownerName: string,
): Promise<Playlist> {
  const existing = playlists.find((p) => p.playlistId === playlistId);
  if (!existing) throw new Error(`Playlist not found: ${playlistId}`);

  const dup = duplicatePlaylist(existing, newTitle);

  try {
    await persistPlaylist(dup, ownerName);
  } catch (error) {
    throw new Error(
      `Failed to publish duplicated playlist: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }

  playlists = [...playlists, dup];
  notify();
  return dup;
}

// ── Version Management ──────────────────────────────────────────────

/**
 * Publish a new immutable playlist version.
 *
 * IMPORTANT: This is NOT atomic across QDN resources.
 * If version publication succeeds but playlist pointer update fails,
 * we report the recoverable partial state.
 */
export async function publishPlaylistVersion(
  input: PlaylistVersionInput,
  ownerName: string,
): Promise<
  | { ok: true; version: PlaylistVersion }
  | { ok: false; error: string; invalidTrackIds: string[] }
  | { ok: false; partial: true; version: PlaylistVersion; error: string }
> {
  const result = createPlaylistVersion(input);

  if (!result.ok) {
    return result;
  }

  const { version } = result;

  // 1. Publish the immutable version resource
  try {
    await persistPlaylistVersion(version, ownerName);
  } catch (error) {
    return {
      ok: false,
      error: `Failed to publish playlist version: ${error instanceof Error ? error.message : 'Unknown error'}`,
      invalidTrackIds: [],
    };
  }

  // 2. Update the logical playlist's latestVersionId pointer
  const playlist = playlists.find((p) => p.playlistId === input.playlistId);
  if (!playlist) {
    // Version published but playlist not in local store — partial state
    return {
      ok: false,
      partial: true,
      version,
      error:
        'Version published successfully but playlist pointer update failed: playlist not found in local store.',
    };
  }

  const updatedPlaylist: Playlist = {
    ...playlist,
    latestVersionId: version.versionId,
    updatedAt: new Date().toISOString(),
  };

  try {
    await persistPlaylist(updatedPlaylist, ownerName);
  } catch (error) {
    // Version published, playlist pointer update failed — partial state
    return {
      ok: false,
      partial: true,
      version,
      error: `Version published but playlist pointer update failed: ${error instanceof Error ? error.message : 'Unknown error'}. The version was saved as ${getPlaylistVersionQdnIdentifier(version.versionId)}.`,
    };
  }

  // 3. Update local state
  const pIndex = playlists.findIndex((p) => p.playlistId === input.playlistId);
  playlists = [...playlists.slice(0, pIndex), updatedPlaylist, ...playlists.slice(pIndex + 1)];

  const existing = playlistVersions.get(input.playlistId) ?? [];
  playlistVersions.set(input.playlistId, [...existing, version]);

  notify();
  return { ok: true, version };
}

/**
 * Tombstone an old immutable PlaylistVersion.
 *
 * The reference check is performed in production code against current QDN
 * state, not only in the UI. This action never deletes the logical Playlist.
 */
export async function deletePlaylistVersion(
  versionId: string,
  ownerName: string,
  ownerAddress: string,
): Promise<void> {
  const playlistEntry = [...playlistVersions.entries()].find(([, versions]) =>
    versions.some((version) => version.versionId === versionId),
  );

  if (!playlistEntry) {
    throw new Error(`Playlist version not found: ${versionId}`);
  }

  const [playlistId, versions] = playlistEntry;
  const version = versions.find((candidate) => candidate.versionId === versionId);
  const playlist = playlists.find((candidate) => candidate.playlistId === playlistId);

  if (!version || !playlist) {
    throw new Error(`Playlist version not found: ${versionId}`);
  }

  if (playlist.ownerAddress !== ownerAddress) {
    throw new Error('Only the station owner may delete playlist versions.');
  }

  const references = await collectPlaylistVersionReferences(versionId, ownerName);
  if (references.length > 0) {
    throw new PlaylistVersionReferencedError(references);
  }

  if (playlist.latestVersionId === versionId) {
    throw new Error('The latest PlaylistVersion cannot be deleted directly.');
  }

  try {
    const result = (await deleteQdnResource({
      service: VERSION_SERVICE,
      name: ownerName,
      identifier: getPlaylistVersionQdnIdentifier(versionId),
    })) as { accepted?: boolean };

    if (result?.accepted !== true) {
      throw new Error('QDN delete was not accepted.');
    }
  } catch (error) {
    throw new Error(
      `Failed to delete playlist version: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }

  const nextVersions = versions.filter((candidate) => candidate.versionId !== versionId);
  playlistVersions.set(playlistId, nextVersions);
  notify();
}

/**
 * Point a logical Playlist back at an existing immutable version without
 * mutating that version resource. This is deliberately a separate,
 * explicit admin action rather than an automatic side effect of deletion.
 */
export async function restorePlaylistVersionAsLatest(
  playlistId: string,
  versionId: string,
  ownerName: string,
  ownerAddress: string,
): Promise<Playlist> {
  const playlist = playlists.find((candidate) => candidate.playlistId === playlistId);
  if (!playlist) {
    throw new Error(`Playlist not found: ${playlistId}`);
  }

  if (playlist.ownerAddress !== ownerAddress) {
    throw new Error('Only the station owner may restore playlist versions.');
  }

  const versions = playlistVersions.get(playlistId) ?? [];
  const version = versions.find((candidate) => candidate.versionId === versionId);
  if (!version) {
    throw new Error(`Playlist version not found: ${versionId}`);
  }

  if (playlist.latestVersionId === versionId) {
    return playlist;
  }

  const updatedPlaylist: Playlist = {
    ...playlist,
    latestVersionId: versionId,
    updatedAt: new Date().toISOString(),
  };

  try {
    await persistPlaylist(updatedPlaylist, ownerName);
  } catch (error) {
    throw new Error(
      `Failed to restore playlist version as latest: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
    );
  }

  const index = playlists.findIndex((candidate) => candidate.playlistId === playlistId);
  playlists = [...playlists.slice(0, index), updatedPlaylist, ...playlists.slice(index + 1)];
  notify();
  return updatedPlaylist;
}

// ── Reset ───────────────────────────────────────────────────────────

export function resetPlaylistStore(): void {
  playlists = [];
  playlistVersions = new Map();
  storeIncomplete = false;
  storeDiagnostics = [];
  storeLoaded = false;
  storeLoading = false;
  storeError = null;
  storeActiveScope = null;
  storeEpoch += 1;
  notify();
}
