/* ============================================================
 * NodeFM Station — Library Service
 *
 * In-memory station library with QDN persistence.
 * The library is a collection of Track metadata resources.
 * Each track is persisted as a QDN JSON resource.
 *
 * NOT a centralized backend — runs entirely in the browser.
 * ============================================================ */

import type { Track } from '../../../types/domain';
import {
  publishResource,
  fetchQdnResourceData,
  searchQdnResources,
  deleteQdnResource,
} from '../../../qortium/qdn';
import {
  serializeTrackForQdn,
  deserializeTrackFromQdn,
  getTrackQdnIdentifier,
  type CreateTrackInput,
  type EditTrackInput,
  createTrack,
  editTrack,
} from '../../tracks/services/trackService';
import {
  getQdnResourceReadErrorCode,
  isConfirmedQdnNotFoundError,
} from '../../../qortium/qdnReadError';

// ── In-Memory Store ─────────────────────────────────────────────────

let libraryTracks: Track[] = [];
let libraryLoaded = false;
let libraryLoading = false;
let libraryError: string | null = null;
let libraryIncomplete = false;
let libraryDiagnostics: LibraryDiagnostic[] = [];
let libraryEpoch = 0;
let libraryActiveScope: string | null = null;
type LibraryListener = () => void;
const listeners = new Set<LibraryListener>();

export type LibraryDiagnosticCode =
  | 'INVALID_METADATA'
  | 'MALFORMED_RESOURCE'
  | 'RESOURCE_UNAVAILABLE'
  | 'RESOURCE_NOT_FOUND'
  | 'IDENTITY_MISMATCH';

export type LibraryDiagnostic = {
  identifier: string;
  code: LibraryDiagnosticCode;
  detail: string;
};

function notifyListeners() {
  listeners.forEach((fn) => fn());
}

function libraryScopeKey(ownerName: string, ownerAddress: string): string {
  return `${ownerAddress}\u0000${ownerName}`;
}

// ── Persistence ─────────────────────────────────────────────────────

const TRACK_SERVICE = 'JSON';
const TRACK_IDENTIFIER_PREFIX = 'nodefm-track-';

async function persistTrack(track: Track, ownerName: string): Promise<void> {
  const json = serializeTrackForQdn(track);
  const base64 = btoa(unescape(encodeURIComponent(json)));

  await publishResource({
    service: TRACK_SERVICE,
    name: ownerName,
    identifier: getTrackQdnIdentifier(track.trackId),
    data64: base64,
    title: track.title,
    description: track.description,
    tags: track.tags,
  });
}

async function fetchTrackFromQdn(ownerName: string, trackId: string): Promise<Track> {
  const payload = await fetchQdnResourceData({
    service: TRACK_SERVICE,
    name: ownerName,
    identifier: getTrackQdnIdentifier(trackId),
  });

  const track = deserializeTrackFromQdn(payload);

  if (!track) {
    throw new Error(`Malformed station track resource: ${getTrackQdnIdentifier(trackId)}`);
  }

  return track;
}

// ── Public API ──────────────────────────────────────────────────────

export function subscribeToLibrary(onChange: LibraryListener): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function getLibraryTracks(): Track[] {
  return [...libraryTracks];
}

export function getLibraryLoaded(): boolean {
  return libraryLoaded;
}

export function getLibraryLoading(): boolean {
  return libraryLoading;
}

export function getLibraryError(): string | null {
  return libraryError;
}

export function getLibraryIncomplete(): boolean {
  return libraryIncomplete;
}

export function getLibraryDiagnostics(): LibraryDiagnostic[] {
  return [...libraryDiagnostics];
}

export function getLibraryActiveScope(): string | null {
  return libraryActiveScope;
}

export function isLibraryCurrentScope(ownerName: string, ownerAddress: string): boolean {
  return libraryActiveScope === libraryScopeKey(ownerName, ownerAddress);
}

export type LibraryLoadAction = 'clear' | 'reuse' | 'load';

/**
 * Decide whether a hook mount should clear state, reuse the already-loaded
 * account-scoped state, or start a fresh load. Keeping this decision here
 * makes the no-op-for-same-account behavior testable and prevents modal
 * remount loops.
 */
export function getLibraryLoadAction(
  ownerName: string | null,
  ownerAddress: string | null,
): LibraryLoadAction {
  if (!ownerName || !ownerAddress) {
    return 'clear';
  }

  if (isLibraryCurrentScope(ownerName, ownerAddress) && (libraryLoaded || libraryLoading)) {
    return 'reuse';
  }

  return 'load';
}

/**
 * Load the station library from QDN.
 * Searches for all track metadata published by this station owner.
 */
export async function loadLibrary(ownerName: string, ownerAddress: string): Promise<void> {
  if (libraryLoaded || libraryLoading) return;

  const targetScope = libraryScopeKey(ownerName, ownerAddress);
  const epoch = libraryEpoch;

  libraryActiveScope = targetScope;
  libraryLoading = true;
  libraryError = null;
  notifyListeners();

  try {
    // Search for all track metadata published under the owner's name with nodefm-track- prefix
    const results = await searchQdnResources({
      service: TRACK_SERVICE,
      name: ownerName,
      query: TRACK_IDENTIFIER_PREFIX,
      prefix: true,
      limit: 500,
      includeMetadata: true,
    });

    const tracks: Track[] = [];
    const diagnostics: LibraryDiagnostic[] = [];
    const seenTrackIdentifiers = new Set<string>();
    let incomplete = false;

    for (const result of results) {
      if (!result.identifier || !result.identifier.startsWith(TRACK_IDENTIFIER_PREFIX)) continue;
      if (seenTrackIdentifiers.has(result.identifier)) continue;

      const identifier = result.identifier;
      const trackId = identifier.slice(TRACK_IDENTIFIER_PREFIX.length);

      try {
        const track = await fetchTrackFromQdn(ownerName, trackId);

        if (track.ownerAddress !== ownerAddress) {
          diagnostics.push({
            identifier,
            code: 'IDENTITY_MISMATCH',
            detail: 'Track owner does not match the station owner.',
          });
          incomplete = true;
          continue;
        }

        seenTrackIdentifiers.add(identifier);
        tracks.push(track);
      } catch (error) {
        if (isConfirmedQdnNotFoundError(error)) {
          diagnostics.push({
            identifier,
            code: 'RESOURCE_NOT_FOUND',
            detail: error instanceof Error ? error.message : 'Track resource was not found.',
          });
          continue;
        }

        const code = getQdnResourceReadErrorCode(error);
        diagnostics.push({
          identifier,
          code: code === 'MALFORMED' ? 'MALFORMED_RESOURCE' : 'RESOURCE_UNAVAILABLE',
          detail: error instanceof Error ? error.message : 'Track resource could not be loaded.',
        });
        incomplete = true;
      }
    }

    if (epoch !== libraryEpoch || libraryActiveScope !== targetScope) {
      return;
    }

    libraryTracks = tracks;
    libraryDiagnostics = diagnostics;
    libraryIncomplete = incomplete;
    libraryLoaded = true;
  } catch (error) {
    if (epoch !== libraryEpoch || libraryActiveScope !== targetScope) {
      return;
    }

    libraryError = error instanceof Error ? error.message : 'Failed to load library.';
  } finally {
    if (epoch === libraryEpoch) {
      libraryLoading = false;
      notifyListeners();
    }
  }
}

/**
 * Add a new track to the library.
 * The track's audio and optional cover must already be published.
 * This only publishes the track metadata resource.
 */
export async function addTrackToLibrary(track: Track, ownerName: string): Promise<Track> {
  try {
    await persistTrack(track, ownerName);
  } catch (error) {
    throw new Error(
      `Failed to publish track metadata: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }

  libraryTracks = [...libraryTracks, track];
  notifyListeners();
  return track;
}

/**
 * Create and add a new track in one operation.
 */
export async function createAndAddTrack(
  input: CreateTrackInput,
  ownerName: string,
): Promise<Track> {
  const track = createTrack(input);
  return addTrackToLibrary(track, ownerName);
}

/**
 * Update an existing track's metadata.
 */
export async function updateTrack(
  trackId: string,
  input: EditTrackInput,
  ownerName: string,
): Promise<Track> {
  const index = libraryTracks.findIndex((t) => t.trackId === trackId);
  if (index === -1) throw new Error(`Track not found: ${trackId}`);

  const updated = editTrack(libraryTracks[index], input);

  try {
    await persistTrack(updated, ownerName);
  } catch (error) {
    throw new Error(
      `Failed to update track metadata: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }

  libraryTracks = [...libraryTracks.slice(0, index), updated, ...libraryTracks.slice(index + 1)];
  notifyListeners();
  return updated;
}

/**
 * Remove a track from the library.
 *
 * Uses the current Qortium Home `DELETE_QDN_RESOURCE` action to tombstone
 * the track metadata resource. The separate AUDIO/COVER QDN resources are
 * intentionally left intact.
 */
export async function removeTrackFromLibrary(trackId: string, ownerName: string): Promise<void> {
  const track = libraryTracks.find((t) => t.trackId === trackId);

  if (!track) {
    throw new Error(`Track not found: ${trackId}`);
  }

  try {
    const result = (await deleteQdnResource({
      service: TRACK_SERVICE,
      name: ownerName,
      identifier: getTrackQdnIdentifier(trackId),
    })) as { accepted?: boolean };

    if (result?.accepted !== true) {
      throw new Error('QDN delete was not accepted.');
    }
  } catch (error) {
    throw new Error(
      `Failed to remove track metadata: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }

  libraryTracks = libraryTracks.filter((t) => t.trackId !== trackId);
  notifyListeners();
}

/**
 * Get a single track by ID from the loaded library.
 */
export function getTrackById(trackId: string): Track | undefined {
  return libraryTracks.find((t) => t.trackId === trackId);
}

/**
 * Reset the library state (useful for testing or account changes).
 */
export function resetLibrary(): void {
  libraryTracks = [];
  libraryIncomplete = false;
  libraryDiagnostics = [];
  libraryLoaded = false;
  libraryLoading = false;
  libraryError = null;
  libraryActiveScope = null;
  libraryEpoch += 1;
  notifyListeners();
}
