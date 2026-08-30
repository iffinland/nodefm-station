/* ============================================================
 * NodeFM Station — useListenerPlaylists Hook
 *
 * React state bridge for listener-owned playlist store and draft
 * store. Every write requires a registered Qortium name from the
 * authenticated account; no fallback owner is supported.
 * ============================================================ */

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../app/providers/authContext';
import type { Playlist, PlaylistVersion, PlaylistVersionTrack } from '../../types/domain';
import type {
  ListenerPlaylistDraft,
  ListenerSubmissionResolution,
  ListenerStationSubmissionResult,
} from './services/listenerPlaylistService';
import {
  addCanonicalTracksToListenerDraft,
  addPendingSubmissionToListenerDraft,
  addOwnerTrackToListenerDraft,
  createListenerPlaylistDraft,
  editListenerPlaylistDraft,
  evaluateListenerDraftPublication,
  evaluateListenerDraftStationSubmission,
  removeListenerDraftEntry,
  reorderListenerDraftEntry,
  resolveListenerDraftEntries,
  rotateListenerDraftStart,
  shuffleListenerDraft,
  type CreateListenerPlaylistDraftInput,
} from './services/listenerPlaylistService';
import {
  clearListenerPlaylistDraft,
  getListenerPlaylistDraft,
  getListenerPlaylistDraftsForOwner,
  resetListenerPlaylistDrafts,
  saveListenerPlaylistDraft,
} from './services/listenerPlaylistDraftStore';
import {
  getLatestListenerPlaylistVersion,
  getListenerPlaylistById,
  getListenerPlaylistStoreDiagnostics,
  getListenerPlaylistStoreError,
  getListenerPlaylistStoreIncomplete,
  getListenerPlaylistStoreLoaded,
  getListenerPlaylistStoreLoading,
  getListenerPlaylistVersions,
  getListenerPlaylists,
  getListenerPlaylistLoadAction,
  loadListenerPlaylists,
  publishListenerPlaylist,
  resetListenerPlaylistStore,
  subscribeToListenerPlaylistStore,
  type ListenerPlaylistDiagnostic,
  type ListenerPlaylistPublishChunk,
  type PublishListenerPlaylistResult,
} from './services/listenerPlaylistStore';
import { resolveListenerSubmissionEntries } from './services/listenerSubmissionResolutionService';

export type UseListenerPlaylistsResult = {
  playlists: Playlist[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
  incomplete: boolean;
  diagnostics: ListenerPlaylistDiagnostic[];
  revision: number;
  ownerName: string | null;
  ownerAddress: string | null;
  hasRegisteredName: boolean;
  getPlaylist: (playlistId: string) => Playlist | undefined;
  getVersions: (playlistId: string) => PlaylistVersion[];
  getLatestVersion: (playlistId: string) => PlaylistVersion | undefined;
  getDrafts: () => ListenerPlaylistDraft[];
  getDraft: (playlistId: string) => ListenerPlaylistDraft | undefined;
  createDraft: (
    input: Omit<CreateListenerPlaylistDraftInput, 'ownerName' | 'ownerAddress'>,
  ) => ListenerPlaylistDraft;
  saveDraft: (draft: ListenerPlaylistDraft) => void;
  addTracks: (
    draft: ListenerPlaylistDraft,
    tracks: ReadonlyArray<{ trackId: string; durationMs: number; title: string; artist?: string }>,
  ) => ListenerPlaylistDraft;
  addPendingSubmission: (
    draft: ListenerPlaylistDraft,
    submission: { submissionId: string; durationMs: number; title: string; artist?: string },
  ) => ListenerPlaylistDraft;
  addOwnerTrack: (
    draft: ListenerPlaylistDraft,
    track: { submissionId: string; durationMs: number; title: string; artist?: string },
  ) => ListenerPlaylistDraft;
  removeEntry: (draft: ListenerPlaylistDraft, entryId: string) => ListenerPlaylistDraft;
  reorderEntry: (
    draft: ListenerPlaylistDraft,
    entryId: string,
    targetIndex: number,
  ) => ListenerPlaylistDraft;
  shuffleDraft: (draft: ListenerPlaylistDraft) => ListenerPlaylistDraft;
  rotateDraft: (draft: ListenerPlaylistDraft) => ListenerPlaylistDraft;
  editDraft: (
    draft: ListenerPlaylistDraft,
    input: { title: string; description?: string; visibility?: 'public' | 'private' },
  ) => ListenerPlaylistDraft;
  resolveSubmissions: (draft: ListenerPlaylistDraft) => Promise<ListenerSubmissionResolution[]>;
  resolveEntries: (
    draft: ListenerPlaylistDraft,
    resolutions: readonly ListenerSubmissionResolution[],
  ) => ReturnType<typeof resolveListenerDraftEntries>;
  evaluatePublication: (
    draft: ListenerPlaylistDraft,
    resolutions: readonly ListenerSubmissionResolution[],
  ) => ReturnType<typeof evaluateListenerDraftPublication>;
  evaluateStationSubmission: (
    draft: ListenerPlaylistDraft,
    resolutions: readonly ListenerSubmissionResolution[],
  ) => ListenerStationSubmissionResult;
  publishDraft: (
    draft: ListenerPlaylistDraft,
    tracks: PlaylistVersionTrack[],
    lastVersion?: PlaylistVersion,
    onProgress?: (chunk: ListenerPlaylistPublishChunk) => void,
  ) => Promise<PublishListenerPlaylistResult>;
  clearDraft: (playlistId: string) => void;
  refresh: () => Promise<void>;
};

export function useListenerPlaylists(): UseListenerPlaylistsResult {
  const { auth, ownerName } = useAuth();
  const ownerAddress = auth.status === 'authenticated' ? auth.address : null;

  const [playlists, setPlaylists] = useState<Playlist[]>(getListenerPlaylists());
  const [loaded, setLoaded] = useState(getListenerPlaylistStoreLoaded());
  const [loading, setLoading] = useState(getListenerPlaylistStoreLoading());
  const [error, setError] = useState<string | null>(getListenerPlaylistStoreError());
  const [incomplete, setIncomplete] = useState(getListenerPlaylistStoreIncomplete());
  const [diagnostics, setDiagnostics] = useState<ListenerPlaylistDiagnostic[]>(
    getListenerPlaylistStoreDiagnostics(),
  );
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const unsubscribe = subscribeToListenerPlaylistStore(() => {
      setPlaylists(getListenerPlaylists());
      setLoaded(getListenerPlaylistStoreLoaded());
      setLoading(getListenerPlaylistStoreLoading());
      setError(getListenerPlaylistStoreError());
      setIncomplete(getListenerPlaylistStoreIncomplete());
      setDiagnostics(getListenerPlaylistStoreDiagnostics());
      setRevision((current) => current + 1);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    const action = getListenerPlaylistLoadAction(ownerName, ownerAddress);

    if (action === 'clear') {
      resetListenerPlaylistStore();
      setPlaylists([]);
      setLoaded(false);
      setLoading(false);
      setError(null);
      setIncomplete(false);
      setDiagnostics([]);
      return;
    }

    if (action === 'reuse') {
      setPlaylists(getListenerPlaylists());
      setLoaded(getListenerPlaylistStoreLoaded());
      setLoading(getListenerPlaylistStoreLoading());
      setError(getListenerPlaylistStoreError());
      setIncomplete(getListenerPlaylistStoreIncomplete());
      setDiagnostics(getListenerPlaylistStoreDiagnostics());
      return;
    }

    if (ownerName && ownerAddress) {
      resetListenerPlaylistStore();
      setPlaylists([]);
      setLoaded(false);
      setLoading(true);
      setError(null);
      setIncomplete(false);
      setDiagnostics([]);
      loadListenerPlaylists(ownerName, ownerAddress);
    }
  }, [ownerName, ownerAddress]);

  const refresh = useCallback(async () => {
    if (!ownerName || !ownerAddress) return;

    resetListenerPlaylistStore();
    setPlaylists([]);
    setLoaded(false);
    setLoading(true);
    setError(null);
    setIncomplete(false);
    setDiagnostics([]);
    await loadListenerPlaylists(ownerName, ownerAddress);
  }, [ownerName, ownerAddress]);

  const throwIfNoIdentity = useCallback(() => {
    if (!ownerName || !ownerAddress) {
      throw new Error('A registered Qortium name is required to create and publish playlists.');
    }
  }, [ownerName, ownerAddress]);

  const createDraft = useCallback(
    (input: Omit<CreateListenerPlaylistDraftInput, 'ownerName' | 'ownerAddress'>) => {
      throwIfNoIdentity();
      const draft = createListenerPlaylistDraft({
        ...input,
        ownerName: ownerName!,
        ownerAddress: ownerAddress!,
      });
      saveListenerPlaylistDraft(draft);
      return draft;
    },
    [ownerAddress, ownerName, throwIfNoIdentity],
  );

  const saveDraft = useCallback((draft: ListenerPlaylistDraft) => {
    saveListenerPlaylistDraft(draft);
  }, []);

  const getDraft = useCallback(
    (playlistId: string) => {
      if (!ownerName || !ownerAddress) return undefined;
      return getListenerPlaylistDraft(ownerName, ownerAddress, playlistId);
    },
    [ownerName, ownerAddress],
  );

  const getDrafts = useCallback(() => {
    if (!ownerName || !ownerAddress) return [];
    return getListenerPlaylistDraftsForOwner(ownerName, ownerAddress);
  }, [ownerName, ownerAddress]);

  const resolveSubmissions = useCallback(
    async (draft: ListenerPlaylistDraft) => {
      const submissionIds = draft.entries
        .filter((entry) => entry.kind === 'pending-submission')
        .map((entry) => entry.submissionId);

      if (submissionIds.length === 0 || !ownerName || !ownerAddress) {
        return [];
      }

      // The station config identity is loaded by the StationProvider and
      // passed by the editor page through this hook's owner identity. For
      // the hook itself, resolution needs station identity; the page calls
      // resolveSubmissionsForStation to keep that dependency explicit.
      return [];
    },
    [ownerName, ownerAddress],
  );

  const clearDraft = useCallback(
    (playlistId: string) => {
      if (!ownerName || !ownerAddress) return;
      clearListenerPlaylistDraft(ownerName, ownerAddress, playlistId);
    },
    [ownerName, ownerAddress],
  );

  return {
    playlists,
    loaded,
    loading,
    error,
    incomplete,
    diagnostics,
    revision,
    ownerName,
    ownerAddress,
    hasRegisteredName: Boolean(ownerName && ownerAddress),
    getPlaylist: getListenerPlaylistById,
    getVersions: getListenerPlaylistVersions,
    getLatestVersion: getLatestListenerPlaylistVersion,
    getDrafts,
    getDraft,
    createDraft,
    saveDraft,
    addTracks: (draft, tracks) => {
      const next = addCanonicalTracksToListenerDraft(draft, tracks);
      saveListenerPlaylistDraft(next);
      return next;
    },
    addPendingSubmission: (draft, submission) => {
      const next = addPendingSubmissionToListenerDraft(draft, submission);
      saveListenerPlaylistDraft(next);
      return next;
    },
    addOwnerTrack: (draft, track) => {
      const next = addOwnerTrackToListenerDraft(draft, track);
      saveListenerPlaylistDraft(next);
      return next;
    },
    removeEntry: (draft, entryId) => {
      const next = removeListenerDraftEntry(draft, entryId);
      saveListenerPlaylistDraft(next);
      return next;
    },
    reorderEntry: (draft, entryId, targetIndex) => {
      const next = reorderListenerDraftEntry(draft, entryId, targetIndex);
      saveListenerPlaylistDraft(next);
      return next;
    },
    shuffleDraft: (draft) => {
      const next = shuffleListenerDraft(draft);
      saveListenerPlaylistDraft(next);
      return next;
    },
    rotateDraft: (draft) => {
      const next = rotateListenerDraftStart(draft);
      saveListenerPlaylistDraft(next);
      return next;
    },
    editDraft: (draft, input) => {
      const next = editListenerPlaylistDraft(draft, input);
      saveListenerPlaylistDraft(next);
      return next;
    },
    resolveSubmissions,
    resolveEntries: resolveListenerDraftEntries,
    evaluatePublication: evaluateListenerDraftPublication,
    evaluateStationSubmission: evaluateListenerDraftStationSubmission,
    publishDraft: publishListenerPlaylist,
    clearDraft,
    refresh,
  };
}

/**
 * Resolution helper used by the listener editor page with the canonical
 * station publisher and owner address explicitly available. It resolves
 * pending submission entries without performing a broad admin upload scan.
 */
export async function resolveListenerPlaylistSubmissions(
  draft: ListenerPlaylistDraft,
  stationPublisherName: string | null,
  stationOwnerAddress: string | null,
): Promise<ListenerSubmissionResolution[]> {
  const submissionIds = draft.entries
    .filter((entry) => entry.kind === 'pending-submission')
    .map((entry) => entry.submissionId);

  if (submissionIds.length === 0 || !stationPublisherName || !stationOwnerAddress) {
    return [];
  }

  return resolveListenerSubmissionEntries({
    stationPublisherName,
    stationOwnerAddress,
    listenerName: draft.ownerName,
    listenerAddress: draft.ownerAddress,
    submissionIds,
  });
}

export function resetAllListenerPlaylistState(): void {
  resetListenerPlaylistStore();
  resetListenerPlaylistDrafts();
}
