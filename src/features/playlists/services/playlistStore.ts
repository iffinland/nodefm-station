/* ============================================================
 * NodeFM Station — Playlist Store
 *
 * In-memory playlist store with QDN persistence.
 * Manages mutable Playlists and immutable PlaylistVersions.
 * ============================================================ */

import type { Playlist, PlaylistVersion } from '../../../types/domain';
import { publishResource, fetchQdnResourceData, searchQdnResources } from '../../../qortium/qdn';
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

// ── In-Memory Store ─────────────────────────────────────────────────

let playlists: Playlist[] = [];
let playlistVersions: Map<string, PlaylistVersion[]> = new Map();
let storeLoaded = false;
let storeLoading = false;
let storeError: string | null = null;
let storeEpoch = 0;
let storeActiveScope: string | null = null;

type StoreListener = () => void;
const listeners = new Set<StoreListener>();

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
    const seenPlaylistIdentifiers = new Set<string>();

    for (const result of playlistResults) {
      if (!result.identifier || !result.identifier.startsWith(PLAYLIST_IDENTIFIER_PREFIX)) continue;
      // Skip version identifiers that happen to share the prefix
      if (result.identifier.startsWith(VERSION_IDENTIFIER_PREFIX)) continue;
      if (seenPlaylistIdentifiers.has(result.identifier)) continue;

      try {
        const payload = await fetchQdnResourceData({
          service: PLAYLIST_SERVICE,
          name: ownerName,
          identifier: result.identifier,
        });
        const playlist = deserializePlaylistFromQdn(payload);
        if (playlist && playlist.ownerAddress === ownerAddress) {
          seenPlaylistIdentifiers.add(result.identifier);
          loaded.push(playlist);
        }
      } catch {
        // skip
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

      try {
        const payload = await fetchQdnResourceData({
          service: VERSION_SERVICE,
          name: ownerName,
          identifier: result.identifier,
        });
        const version = deserializePlaylistVersionFromQdn(payload);
        if (version) {
          seenVersionIdentifiers.add(result.identifier);
          const existing = versionMap.get(version.playlistId) ?? [];
          existing.push(version);
          versionMap.set(version.playlistId, existing);
        }
      } catch {
        // skip
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

// ── Reset ───────────────────────────────────────────────────────────

export function resetPlaylistStore(): void {
  playlists = [];
  playlistVersions = new Map();
  storeLoaded = false;
  storeLoading = false;
  storeError = null;
  storeActiveScope = null;
  storeEpoch += 1;
  notify();
}
