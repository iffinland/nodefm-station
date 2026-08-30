/* ============================================================
 * NodeFM Station — Listener Playlist Draft Store
 *
 * Account/registered-name-scoped durable draft storage for
 * listener-owned playlists. Drafts persist in browser localStorage
 * with schema validation and an explicit fallback to in-memory state
 * in non-browser tests. They never contain file handles or secret
 * material, only playlist metadata and track/submission references.
 * ============================================================ */

import {
  cloneListenerDraft,
  isListenerPlaylistDraft,
  type ListenerPlaylistDraft,
} from './listenerPlaylistService';

const STORAGE_PREFIX = 'nodefm.listener-playlist-draft.v1.';

let memoryDrafts = new Map<string, ListenerPlaylistDraft>();

function storageKey(ownerName: string, ownerAddress: string, playlistId: string): string {
  return `${STORAGE_PREFIX}${ownerAddress.trim()}\u0000${ownerName.trim()}\u0000${playlistId.trim()}`;
}

function readStorage(key: string): string | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return null;
    }

    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }

    window.localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable in private browsing. In-memory state still
    // keeps the current session safe and the caller is not blocked.
  }
}

function removeStorage(key: string): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }

    window.localStorage.removeItem(key);
  } catch {
    // Ignore. In-memory state is cleared below.
  }
}

function persistDraft(draft: ListenerPlaylistDraft): void {
  const key = storageKey(draft.ownerName, draft.ownerAddress, draft.playlistId);
  memoryDrafts.set(key, cloneListenerDraft(draft));
  writeStorage(key, JSON.stringify(draft));
}

function removeDraft(ownerName: string, ownerAddress: string, playlistId: string): void {
  const key = storageKey(ownerName, ownerAddress, playlistId);
  memoryDrafts.delete(key);
  removeStorage(key);
}

function parseDraft(value: string | null): ListenerPlaylistDraft | null {
  if (!value) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(value);
    return isListenerPlaylistDraft(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function loadDraft(
  ownerName: string,
  ownerAddress: string,
  playlistId: string,
): ListenerPlaylistDraft | undefined {
  const key = storageKey(ownerName, ownerAddress, playlistId);
  const memory = memoryDrafts.get(key);
  if (memory) {
    return cloneListenerDraft(memory);
  }

  const stored = readStorage(key);
  if (!stored) {
    return undefined;
  }

  const parsed = parseDraft(stored);
  if (!parsed) {
    removeStorage(key);
    return undefined;
  }

  memoryDrafts.set(key, cloneListenerDraft(parsed));
  return parsed;
}

export function getListenerPlaylistDraft(
  ownerName: string,
  ownerAddress: string,
  playlistId: string,
): ListenerPlaylistDraft | undefined {
  if (!ownerName.trim() || !ownerAddress.trim() || !playlistId.trim()) {
    return undefined;
  }

  return loadDraft(ownerName, ownerAddress, playlistId);
}

export function getListenerPlaylistDraftsForOwner(
  ownerName: string,
  ownerAddress: string,
): ListenerPlaylistDraft[] {
  if (!ownerName.trim() || !ownerAddress.trim()) {
    return [];
  }

  const prefix = `${STORAGE_PREFIX}${ownerAddress.trim()}\u0000${ownerName.trim()}\u0000`;
  const drafts = new Map<string, ListenerPlaylistDraft>();

  for (const [key, value] of memoryDrafts) {
    if (key.startsWith(prefix)) {
      drafts.set(value.playlistId, cloneListenerDraft(value));
    }
  }

  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (!key?.startsWith(prefix)) continue;

        const parsed = parseDraft(window.localStorage.getItem(key));
        if (parsed && !drafts.has(parsed.playlistId)) {
          drafts.set(parsed.playlistId, parsed);
        }
      }
    }
  } catch {
    // Ignore storage unavailability.
  }

  return [...drafts.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function saveListenerPlaylistDraft(draft: ListenerPlaylistDraft): void {
  persistDraft(draft);
}

export function clearListenerPlaylistDraft(
  ownerName: string,
  ownerAddress: string,
  playlistId: string,
): void {
  removeDraft(ownerName, ownerAddress, playlistId);
}

/** Drop corrupt or stale drafts in tests. */
export function resetListenerPlaylistDrafts(): void {
  memoryDrafts = new Map();

  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }

    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(STORAGE_PREFIX)) {
        keys.push(key);
      }
    }

    keys.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // Ignore storage unavailability.
  }
}
