/* ============================================================
 * NodeFM Station — Listener Playlist Store
 *
 * Account/registered-name-scoped QDN persistence for listener-owned
 * logical playlists and immutable playlist versions. It reuses the
 * same domain entities and serialization rules as station playlists,
 * but discovery and publication are keyed to the listener's selected
 * registered Qortium name, never the NodeFM station publisher.
 * ============================================================ */

import type { Playlist, PlaylistVersion, PlaylistVersionTrack } from '../../../types/domain';
import {
  fetchQdnResourceData,
  qdnJsonPublishFileName,
  publishMultipleResources,
  searchQdnResources,
} from '../../../qortium/qdn';
import type { PublishMultipleResource } from '../../../qortium/qdn';
import {
  getQdnResourceReadErrorCode,
  isConfirmedQdnNotFoundError,
} from '../../../qortium/qdnReadError';
import {
  deserializePlaylistFromQdn,
  deserializePlaylistVersionFromQdn,
  serializePlaylistForQdn,
  serializePlaylistVersionForQdn,
} from '../../playlists/services/playlistService';
import {
  createListenerPlaylistVersionFromDraft,
  getListenerPlaylistQdnIdentifier,
  getListenerPlaylistDisplayTitle,
  getListenerPlaylistVersionQdnIdentifier,
  LISTENER_PLAYLIST_IDENTIFIER_PREFIX,
  LISTENER_PLAYLIST_QDN_SERVICE,
  LISTENER_PLAYLIST_VERSION_IDENTIFIER_PREFIX,
  toListenerPlaylist,
  type ListenerPlaylistDraft,
} from './listenerPlaylistService';

type StoreListener = () => void;

export type ListenerPlaylistDiagnosticCode =
  | 'INVALID_METADATA'
  | 'MALFORMED_RESOURCE'
  | 'RESOURCE_UNAVAILABLE'
  | 'RESOURCE_NOT_FOUND'
  | 'IDENTITY_MISMATCH';

export type ListenerPlaylistDiagnostic = {
  identifier: string;
  kind: 'playlist' | 'version';
  code: ListenerPlaylistDiagnosticCode;
  detail: string;
};

let playlists: Playlist[] = [];
let versionsByPlaylist = new Map<string, PlaylistVersion[]>();
let loaded = false;
let loading = false;
let error: string | null = null;
let incomplete = false;
let diagnostics: ListenerPlaylistDiagnostic[] = [];
let epoch = 0;
let activeScope: string | null = null;

const listeners = new Set<StoreListener>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

function scopeKey(ownerName: string, ownerAddress: string): string {
  return `${ownerAddress.trim()}\u0000${ownerName.trim()}`;
}

export function subscribeToListenerPlaylistStore(listener: StoreListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getListenerPlaylists(): Playlist[] {
  return [...playlists];
}

export function getListenerPlaylistById(playlistId: string): Playlist | undefined {
  return playlists.find((playlist) => playlist.playlistId === playlistId);
}

export function getListenerPlaylistVersions(playlistId: string): PlaylistVersion[] {
  return [...(versionsByPlaylist.get(playlistId) ?? [])];
}

export function getLatestListenerPlaylistVersion(playlistId: string): PlaylistVersion | undefined {
  const versions = versionsByPlaylist.get(playlistId);
  return versions && versions.length > 0 ? versions[versions.length - 1] : undefined;
}

export function getListenerPlaylistStoreLoaded(): boolean {
  return loaded;
}

export function getListenerPlaylistStoreLoading(): boolean {
  return loading;
}

export function getListenerPlaylistStoreError(): string | null {
  return error;
}

export function getListenerPlaylistStoreIncomplete(): boolean {
  return incomplete;
}

export function getListenerPlaylistStoreDiagnostics(): ListenerPlaylistDiagnostic[] {
  return [...diagnostics];
}

export function isListenerPlaylistStoreCurrentScope(
  ownerName: string,
  ownerAddress: string,
): boolean {
  return activeScope === scopeKey(ownerName, ownerAddress);
}

export type ListenerPlaylistLoadAction = 'clear' | 'reuse' | 'load';

export function getListenerPlaylistLoadAction(
  ownerName: string | null,
  ownerAddress: string | null,
): ListenerPlaylistLoadAction {
  if (!ownerName || !ownerAddress) {
    return 'clear';
  }

  if (isListenerPlaylistStoreCurrentScope(ownerName, ownerAddress) && (loaded || loading)) {
    return 'reuse';
  }

  return 'load';
}

function playlistPublishResource(playlist: Playlist, ownerName: string): PublishMultipleResource {
  const identifier = getListenerPlaylistQdnIdentifier(playlist.playlistId);

  return {
    service: LISTENER_PLAYLIST_QDN_SERVICE,
    name: ownerName.trim(),
    identifier,
    bytesBase64: btoa(unescape(encodeURIComponent(serializePlaylistForQdn(playlist)))),
    fileName: qdnJsonPublishFileName(identifier),
    mimeType: 'application/json',
    title: playlist.title,
    description: playlist.description,
  };
}

function versionPublishResource(
  version: PlaylistVersion,
  ownerName: string,
): PublishMultipleResource {
  const identifier = getListenerPlaylistVersionQdnIdentifier(version.versionId);

  return {
    service: 'JSON',
    name: ownerName.trim(),
    identifier,
    bytesBase64: btoa(unescape(encodeURIComponent(serializePlaylistVersionForQdn(version)))),
    fileName: qdnJsonPublishFileName(identifier),
    mimeType: 'application/json',
    title: `Listener playlist version ${version.versionNumber}`,
  };
}

export async function loadListenerPlaylists(
  ownerName: string,
  ownerAddress: string,
): Promise<void> {
  if (!ownerName.trim() || !ownerAddress.trim()) {
    return;
  }

  if (loaded || loading) {
    return;
  }

  const targetScope = scopeKey(ownerName, ownerAddress);
  const currentEpoch = epoch;

  activeScope = targetScope;
  loading = true;
  error = null;
  notify();

  try {
    const playlistResults = await searchQdnResources({
      service: LISTENER_PLAYLIST_QDN_SERVICE,
      name: ownerName.trim(),
      query: LISTENER_PLAYLIST_IDENTIFIER_PREFIX,
      prefix: true,
      limit: 500,
      includeMetadata: true,
    });

    const nextPlaylists: Playlist[] = [];
    const nextDiagnostics: ListenerPlaylistDiagnostic[] = [];
    let nextIncomplete = false;
    const seenPlaylists = new Set<string>();

    for (const result of playlistResults) {
      const identifier = result.identifier ?? '';
      if (!identifier.startsWith(LISTENER_PLAYLIST_IDENTIFIER_PREFIX)) continue;
      if (identifier.startsWith(LISTENER_PLAYLIST_VERSION_IDENTIFIER_PREFIX)) continue;
      if (seenPlaylists.has(identifier)) continue;

      seenPlaylists.add(identifier);

      try {
        const payload = await fetchQdnResourceData({
          service: LISTENER_PLAYLIST_QDN_SERVICE,
          name: ownerName.trim(),
          identifier,
        });
        const playlist = deserializePlaylistFromQdn(payload);

        if (!playlist) {
          nextDiagnostics.push({
            identifier,
            kind: 'playlist',
            code: 'MALFORMED_RESOURCE',
            detail: 'Logical listener playlist resource is malformed.',
          });
          nextIncomplete = true;
          continue;
        }

        if (playlist.ownerAddress.trim() !== ownerAddress.trim()) {
          nextDiagnostics.push({
            identifier,
            kind: 'playlist',
            code: 'IDENTITY_MISMATCH',
            detail: 'Playlist owner does not match the selected listener account.',
          });
          nextIncomplete = true;
          continue;
        }

        if (playlist.playlistId !== identifier.slice(LISTENER_PLAYLIST_IDENTIFIER_PREFIX.length)) {
          nextDiagnostics.push({
            identifier,
            kind: 'playlist',
            code: 'IDENTITY_MISMATCH',
            detail: 'Playlist resource identifier does not match the logical playlist ID.',
          });
          nextIncomplete = true;
          continue;
        }

        nextPlaylists.push(playlist);
      } catch (loadError) {
        if (isConfirmedQdnNotFoundError(loadError)) {
          nextDiagnostics.push({
            identifier,
            kind: 'playlist',
            code: 'RESOURCE_NOT_FOUND',
            detail:
              loadError instanceof Error
                ? loadError.message
                : 'Listener playlist resource was not found.',
          });
          continue;
        }

        const code = getQdnResourceReadErrorCode(loadError);
        nextDiagnostics.push({
          identifier,
          kind: 'playlist',
          code: code === 'MALFORMED' ? 'MALFORMED_RESOURCE' : 'RESOURCE_UNAVAILABLE',
          detail:
            loadError instanceof Error
              ? loadError.message
              : 'Listener playlist resource could not be loaded.',
        });
        nextIncomplete = true;
      }
    }

    if (currentEpoch !== epoch || activeScope !== targetScope) {
      return;
    }

    const versionResults = await searchQdnResources({
      service: 'JSON',
      name: ownerName.trim(),
      query: LISTENER_PLAYLIST_VERSION_IDENTIFIER_PREFIX,
      prefix: true,
      limit: 1000,
      includeMetadata: true,
    });

    const nextVersionMap = new Map<string, PlaylistVersion[]>();
    const seenVersions = new Set<string>();

    for (const result of versionResults) {
      const identifier = result.identifier ?? '';
      if (!identifier.startsWith(LISTENER_PLAYLIST_VERSION_IDENTIFIER_PREFIX)) continue;
      if (seenVersions.has(identifier)) continue;
      seenVersions.add(identifier);

      try {
        const payload = await fetchQdnResourceData({
          service: 'JSON',
          name: ownerName.trim(),
          identifier,
        });
        const version = deserializePlaylistVersionFromQdn(payload);

        if (!version) {
          nextDiagnostics.push({
            identifier,
            kind: 'version',
            code: 'MALFORMED_RESOURCE',
            detail: 'Listener playlist version resource is malformed.',
          });
          nextIncomplete = true;
          continue;
        }

        seenVersions.add(identifier);
        const versions = nextVersionMap.get(version.playlistId) ?? [];
        versions.push(version);
        nextVersionMap.set(version.playlistId, versions);
      } catch (loadError) {
        if (isConfirmedQdnNotFoundError(loadError)) {
          nextDiagnostics.push({
            identifier,
            kind: 'version',
            code: 'RESOURCE_NOT_FOUND',
            detail:
              loadError instanceof Error
                ? loadError.message
                : 'Listener playlist version resource was not found.',
          });
          continue;
        }

        const code = getQdnResourceReadErrorCode(loadError);
        nextDiagnostics.push({
          identifier,
          kind: 'version',
          code: code === 'MALFORMED' ? 'MALFORMED_RESOURCE' : 'RESOURCE_UNAVAILABLE',
          detail:
            loadError instanceof Error
              ? loadError.message
              : 'Listener playlist version resource could not be loaded.',
        });
        nextIncomplete = true;
      }
    }

    for (const [, versions] of nextVersionMap) {
      versions.sort((left, right) => left.versionNumber - right.versionNumber);
    }

    if (currentEpoch !== epoch || activeScope !== targetScope) {
      return;
    }

    playlists = nextPlaylists;
    versionsByPlaylist = nextVersionMap;
    diagnostics = nextDiagnostics;
    incomplete = nextIncomplete;
    loaded = true;
  } catch (loadError) {
    if (currentEpoch !== epoch || activeScope !== targetScope) {
      return;
    }

    error = loadError instanceof Error ? loadError.message : 'Failed to load listener playlists.';
  } finally {
    if (currentEpoch === epoch) {
      loading = false;
      notify();
    }
  }
}

export type PublishListenerPlaylistResult =
  | { ok: true; playlist: Playlist; version: PlaylistVersion }
  | { ok: false; error: string; invalidTrackIds: string[] }
  | { ok: false; partial: true; playlist?: Playlist; version: PlaylistVersion; error: string };

export type ListenerPlaylistPublishChunk = 'prepare' | 'playlist' | 'version' | 'pointer';

export async function publishListenerPlaylist(
  draft: ListenerPlaylistDraft,
  tracks: PlaylistVersionTrack[],
  lastVersion?: PlaylistVersion,
  onProgress?: (chunk: ListenerPlaylistPublishChunk) => void,
): Promise<PublishListenerPlaylistResult> {
  if (!draft.ownerName.trim()) {
    return {
      ok: false,
      error: 'A registered Qortium name is required to publish a listener playlist.',
      invalidTrackIds: [],
    };
  }

  onProgress?.('prepare');
  const versionResult = createListenerPlaylistVersionFromDraft(draft, tracks, lastVersion);
  if (!versionResult.ok) {
    return versionResult;
  }

  const version = versionResult.version;
  const existingPlaylist = getListenerPlaylistById(draft.playlistId);
  const basePlaylist = existingPlaylist ?? toListenerPlaylist(draft, version.versionId);
  const updatedPlaylist: Playlist = {
    ...basePlaylist,
    title: getListenerPlaylistDisplayTitle(draft),
    description: draft.description,
    visibility: draft.visibility ?? 'private',
    latestVersionId: version.versionId,
    updatedAt: new Date().toISOString(),
  };

  const versionResource = versionPublishResource(version, draft.ownerName);
  const pointerResource = playlistPublishResource(updatedPlaylist, draft.ownerName);
  const versionIdentifier = getListenerPlaylistVersionQdnIdentifier(version.versionId);
  const pointerIdentifier = getListenerPlaylistQdnIdentifier(draft.playlistId);

  if (!existingPlaylist) {
    onProgress?.('playlist');
  }
  onProgress?.('version');
  onProgress?.('pointer');

  try {
    const response = await publishMultipleResources([versionResource, pointerResource]);
    const versionPublished = response.accepted
      ? response.published.some((entry) => entry.resource.identifier === versionIdentifier)
      : false;
    const pointerPublished = response.accepted
      ? response.published.some((entry) => entry.resource.identifier === pointerIdentifier)
      : false;
    const versionFailure = response.failures.find(
      (entry) => entry.resource.identifier === versionIdentifier,
    );
    const pointerFailure = response.failures.find(
      (entry) => entry.resource.identifier === pointerIdentifier,
    );

    if (!versionPublished) {
      return {
        ok: false,
        error: `Failed to publish listener playlist version: ${
          versionFailure?.error ?? 'QDN batch publication returned no result for the version.'
        }`,
        invalidTrackIds: [],
      };
    }

    if (!pointerPublished) {
      return {
        ok: false,
        partial: true,
        playlist: updatedPlaylist,
        version,
        error: `Version published but listener playlist pointer update failed: ${
          pointerFailure?.error ?? 'QDN batch publication returned no result for the pointer.'
        }.`,
      };
    }
  } catch (publishError) {
    return {
      ok: false,
      error: `Failed to publish listener playlist: ${
        publishError instanceof Error ? publishError.message : 'Unknown error'
      }`,
      invalidTrackIds: [],
    };
  }

  const playlistIndex = playlists.findIndex(
    (candidate) => candidate.playlistId === draft.playlistId,
  );
  if (playlistIndex === -1) {
    playlists = [...playlists, updatedPlaylist];
  } else {
    playlists = [
      ...playlists.slice(0, playlistIndex),
      updatedPlaylist,
      ...playlists.slice(playlistIndex + 1),
    ];
  }

  const versions = versionsByPlaylist.get(draft.playlistId) ?? [];
  versionsByPlaylist.set(draft.playlistId, [...versions, version]);

  notify();
  return { ok: true, playlist: updatedPlaylist, version };
}

export function resetListenerPlaylistStore(): void {
  epoch += 1;
  playlists = [];
  versionsByPlaylist = new Map();
  loaded = false;
  loading = false;
  error = null;
  incomplete = false;
  diagnostics = [];
  activeScope = null;
  notify();
}
