/* ============================================================
 * NodeFM Station — usePlaylists Hook
 *
 * React hook for playlist store state.
 * ============================================================ */

import { useState, useEffect, useCallback } from 'react';
import type { Playlist, PlaylistVersion } from '../types/domain';
import {
  loadPlaylistStore,
  subscribeToPlaylistStore,
  getPlaylists,
  getPlaylistById,
  getPlaylistVersions,
  getLatestPlaylistVersion,
  getStoreLoaded,
  getStoreLoading,
  getStoreError,
  getStoreIncomplete,
  getStoreDiagnostics,
  addPlaylist,
  updatePlaylist,
  duplicatePlaylistAction,
  publishPlaylistVersion,
  deletePlaylistVersion,
  restorePlaylistVersionAsLatest,
  getStoreLoadAction,
  resetPlaylistStore,
} from '../features/playlists/services/playlistStore';
import type {
  CreatePlaylistInput,
  EditPlaylistInput,
  PlaylistVersionInput,
} from '../features/playlists/services/playlistService';
import type { PlaylistStoreDiagnostic } from '../features/playlists/services/playlistStore';
import { useStationIdentity } from '../features/station';

export type UsePlaylistsResult = {
  playlists: Playlist[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
  incomplete: boolean;
  diagnostics: PlaylistStoreDiagnostic[];
  revision: number;
  getPlaylist: (id: string) => Playlist | undefined;
  getVersions: (id: string) => PlaylistVersion[];
  getLatestVersion: (id: string) => PlaylistVersion | undefined;
  createPlaylist: (input: CreatePlaylistInput) => Promise<Playlist>;
  editPlaylist: (id: string, input: EditPlaylistInput) => Promise<Playlist>;
  duplicatePlaylist: (id: string, newTitle?: string) => Promise<Playlist>;
  publishVersion: (
    input: PlaylistVersionInput,
  ) => Promise<
    | { ok: true; version: PlaylistVersion }
    | { ok: false; error: string; invalidTrackIds: string[] }
    | { ok: false; partial: true; version: PlaylistVersion; error: string }
  >;
  deleteVersion: (versionId: string) => Promise<void>;
  restoreVersionAsLatest: (playlistId: string, versionId: string) => Promise<Playlist>;
  refresh: () => Promise<void>;
};

export function usePlaylists(): UsePlaylistsResult {
  const { ownerAddress, publisherName } = useStationIdentity();

  const [playlists, setPlaylists] = useState<Playlist[]>(getPlaylists());
  const [loaded, setLoaded] = useState(getStoreLoaded());
  const [loading, setLoading] = useState(getStoreLoading());
  const [error, setError] = useState<string | null>(getStoreError());
  const [incomplete, setIncomplete] = useState(getStoreIncomplete());
  const [diagnostics, setDiagnostics] = useState<PlaylistStoreDiagnostic[]>(getStoreDiagnostics());
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const unsubscribe = subscribeToPlaylistStore(() => {
      setPlaylists(getPlaylists());
      setLoaded(getStoreLoaded());
      setLoading(getStoreLoading());
      setError(getStoreError());
      setIncomplete(getStoreIncomplete());
      setDiagnostics(getStoreDiagnostics());
      setRevision((current) => current + 1);
    });

    return unsubscribe;
  }, []);

  const refresh = useCallback(async () => {
    if (!ownerAddress || !publisherName) return;
    resetPlaylistStore();
    setPlaylists([]);
    setLoaded(false);
    setLoading(true);
    setIncomplete(false);
    setDiagnostics([]);
    await loadPlaylistStore(publisherName, ownerAddress);
  }, [ownerAddress, publisherName]);

  useEffect(() => {
    const action = getStoreLoadAction(publisherName, ownerAddress);

    if (action === 'clear') {
      resetPlaylistStore();
      setPlaylists([]);
      setLoaded(false);
      setLoading(false);
      setError(null);
      setIncomplete(false);
      setDiagnostics([]);
      return;
    }

    if (action === 'reuse') {
      setPlaylists(getPlaylists());
      setLoaded(getStoreLoaded());
      setLoading(getStoreLoading());
      setError(getStoreError());
      setIncomplete(getStoreIncomplete());
      setDiagnostics(getStoreDiagnostics());
      return;
    }

    if (publisherName && ownerAddress) {
      resetPlaylistStore();
      setPlaylists([]);
      setLoaded(false);
      setLoading(true);
      setError(null);
      setIncomplete(false);
      setDiagnostics([]);
      loadPlaylistStore(publisherName, ownerAddress);
    }
  }, [ownerAddress, publisherName]);

  const throwIfNoName = () => {
    if (!publisherName || !ownerAddress) {
      throw new Error('A registered Qortium name and owner account are required.');
    }
  };

  return {
    playlists,
    loaded,
    loading,
    error,
    incomplete,
    diagnostics,
    revision,
    getPlaylist: getPlaylistById,
    getVersions: getPlaylistVersions,
    getLatestVersion: getLatestPlaylistVersion,
    createPlaylist: async (input: CreatePlaylistInput) => {
      throwIfNoName();
      return addPlaylist(input, publisherName!);
    },
    editPlaylist: async (id: string, input: EditPlaylistInput) => {
      throwIfNoName();
      return updatePlaylist(id, input, publisherName!);
    },
    duplicatePlaylist: async (id: string, newTitle?: string) => {
      throwIfNoName();
      return duplicatePlaylistAction(id, newTitle, publisherName!);
    },
    publishVersion: async (input: PlaylistVersionInput) => {
      throwIfNoName();
      return publishPlaylistVersion(input, publisherName!);
    },
    deleteVersion: async (versionId: string) => {
      throwIfNoName();
      return deletePlaylistVersion(versionId, publisherName!, ownerAddress!);
    },
    restoreVersionAsLatest: async (playlistId: string, versionId: string) => {
      throwIfNoName();
      return restorePlaylistVersionAsLatest(playlistId, versionId, publisherName!, ownerAddress!);
    },
    refresh,
  };
}
