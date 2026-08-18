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
  addPlaylist,
  updatePlaylist,
  duplicatePlaylistAction,
  publishPlaylistVersion,
  getStoreLoadAction,
  resetPlaylistStore,
} from '../features/playlists/services/playlistStore';
import type {
  CreatePlaylistInput,
  EditPlaylistInput,
  PlaylistVersionInput,
} from '../features/playlists/services/playlistService';
import { useAuth } from '../app/providers/authContext';

export type UsePlaylistsResult = {
  playlists: Playlist[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
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
  refresh: () => Promise<void>;
};

export function usePlaylists(): UsePlaylistsResult {
  const { auth, ownerName } = useAuth();
  const ownerAddress = auth.status === 'authenticated' ? auth.address : null;

  const [playlists, setPlaylists] = useState<Playlist[]>(getPlaylists());
  const [loaded, setLoaded] = useState(getStoreLoaded());
  const [loading, setLoading] = useState(getStoreLoading());
  const [error, setError] = useState<string | null>(getStoreError());

  useEffect(() => {
    const unsubscribe = subscribeToPlaylistStore(() => {
      setPlaylists(getPlaylists());
      setLoaded(getStoreLoaded());
      setLoading(getStoreLoading());
      setError(getStoreError());
    });

    return unsubscribe;
  }, []);

  const refresh = useCallback(async () => {
    if (!ownerAddress || !ownerName) return;
    resetPlaylistStore();
    setPlaylists([]);
    setLoaded(false);
    setLoading(true);
    await loadPlaylistStore(ownerName, ownerAddress);
  }, [ownerAddress, ownerName]);

  useEffect(() => {
    const action = getStoreLoadAction(ownerName, ownerAddress);

    if (action === 'clear') {
      resetPlaylistStore();
      setPlaylists([]);
      setLoaded(false);
      setLoading(false);
      setError(null);
      return;
    }

    if (action === 'reuse') {
      setPlaylists(getPlaylists());
      setLoaded(getStoreLoaded());
      setLoading(getStoreLoading());
      setError(getStoreError());
      return;
    }

    if (ownerName && ownerAddress) {
      resetPlaylistStore();
      setPlaylists([]);
      setLoaded(false);
      setLoading(true);
      setError(null);
      loadPlaylistStore(ownerName, ownerAddress);
    }
  }, [ownerAddress, ownerName]);

  const throwIfNoName = () => {
    if (!ownerName) throw new Error('A registered Qortium name is required.');
  };

  return {
    playlists,
    loaded,
    loading,
    error,
    getPlaylist: getPlaylistById,
    getVersions: getPlaylistVersions,
    getLatestVersion: getLatestPlaylistVersion,
    createPlaylist: async (input: CreatePlaylistInput) => {
      throwIfNoName();
      return addPlaylist(input, ownerName!);
    },
    editPlaylist: async (id: string, input: EditPlaylistInput) => {
      throwIfNoName();
      return updatePlaylist(id, input, ownerName!);
    },
    duplicatePlaylist: async (id: string, newTitle?: string) => {
      throwIfNoName();
      return duplicatePlaylistAction(id, newTitle, ownerName!);
    },
    publishVersion: async (input: PlaylistVersionInput) => {
      throwIfNoName();
      return publishPlaylistVersion(input, ownerName!);
    },
    refresh,
  };
}
