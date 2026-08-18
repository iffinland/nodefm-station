/* ============================================================
 * NodeFM Station — useLibrary Hook
 *
 * React hook for station music library state.
 * ============================================================ */

import { useState, useEffect, useCallback } from 'react';
import type { Track } from '../types/domain';
import {
  loadLibrary,
  subscribeToLibrary,
  getLibraryTracks,
  getLibraryLoaded,
  getLibraryLoading,
  getLibraryError,
  addTrackToLibrary,
  updateTrack,
  removeTrackFromLibrary,
  createAndAddTrack,
  getTrackById,
  getLibraryLoadAction,
  resetLibrary,
} from '../features/library/services/libraryService';
import type { CreateTrackInput, EditTrackInput } from '../features/tracks/services/trackService';
import { useAuth } from '../app/providers/authContext';

export type UseLibraryResult = {
  tracks: Track[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
  addTrack: (track: Track) => Promise<Track>;
  createTrack: (input: CreateTrackInput) => Promise<Track>;
  editTrack: (trackId: string, input: EditTrackInput) => Promise<Track>;
  removeTrack: (trackId: string) => Promise<void>;
  getTrack: (trackId: string) => Track | undefined;
  refresh: () => Promise<void>;
};

export function useLibrary(): UseLibraryResult {
  const { auth, ownerName } = useAuth();
  const ownerAddress = auth.status === 'authenticated' ? auth.address : null;

  const [tracks, setTracks] = useState<Track[]>(getLibraryTracks());
  const [loaded, setLoaded] = useState(getLibraryLoaded());
  const [loading, setLoading] = useState(getLibraryLoading());
  const [error, setError] = useState<string | null>(getLibraryError());

  useEffect(() => {
    const unsubscribe = subscribeToLibrary(() => {
      setTracks(getLibraryTracks());
      setLoaded(getLibraryLoaded());
      setLoading(getLibraryLoading());
      setError(getLibraryError());
    });

    return unsubscribe;
  }, []);

  const refresh = useCallback(async () => {
    if (!ownerAddress || !ownerName) return;
    resetLibrary();
    setTracks([]);
    setLoaded(false);
    setLoading(true);
    await loadLibrary(ownerName, ownerAddress);
  }, [ownerAddress, ownerName]);

  useEffect(() => {
    const action = getLibraryLoadAction(ownerName, ownerAddress);

    if (action === 'clear') {
      resetLibrary();
      setTracks([]);
      setLoaded(false);
      setLoading(false);
      setError(null);
      return;
    }

    if (action === 'reuse') {
      setTracks(getLibraryTracks());
      setLoaded(getLibraryLoaded());
      setLoading(getLibraryLoading());
      setError(getLibraryError());
      return;
    }

    if (ownerName && ownerAddress) {
      resetLibrary();
      setTracks([]);
      setLoaded(false);
      setLoading(true);
      setError(null);
      loadLibrary(ownerName, ownerAddress);
    }
  }, [ownerAddress, ownerName]);

  const removeTrack = useCallback(
    async (trackId: string) => {
      if (!ownerName) {
        throw new Error('A registered Qortium name is required.');
      }

      await removeTrackFromLibrary(trackId, ownerName);
    },
    [ownerName],
  );

  return {
    tracks,
    loaded,
    loading,
    error,
    addTrack: ownerName
      ? (track: Track) => addTrackToLibrary(track, ownerName)
      : async () => {
          throw new Error('A registered Qortium name is required.');
        },
    createTrack: ownerName
      ? (input: CreateTrackInput) => createAndAddTrack(input, ownerName)
      : async () => {
          throw new Error('A registered Qortium name is required.');
        },
    editTrack: ownerName
      ? (trackId: string, input: EditTrackInput) => updateTrack(trackId, input, ownerName)
      : async () => {
          throw new Error('A registered Qortium name is required.');
        },
    removeTrack,
    getTrack: getTrackById,
    refresh,
  };
}
