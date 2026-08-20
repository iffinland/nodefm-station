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
  getLibraryIncomplete,
  getLibraryDiagnostics,
  addTrackToLibrary,
  updateTrack,
  removeTrackFromLibrary,
  createAndAddTrack,
  getTrackById,
  getLibraryLoadAction,
  resetLibrary,
} from '../features/library/services/libraryService';
import type { CreateTrackInput, EditTrackInput } from '../features/tracks/services/trackService';
import type { LibraryDiagnostic } from '../features/library/services/libraryService';
import { useStationIdentity } from '../features/station';

export type UseLibraryResult = {
  tracks: Track[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
  incomplete: boolean;
  diagnostics: LibraryDiagnostic[];
  addTrack: (track: Track) => Promise<Track>;
  createTrack: (input: CreateTrackInput) => Promise<Track>;
  editTrack: (trackId: string, input: EditTrackInput) => Promise<Track>;
  removeTrack: (trackId: string) => Promise<void>;
  getTrack: (trackId: string) => Track | undefined;
  refresh: () => Promise<void>;
};

export function useLibrary(): UseLibraryResult {
  const { ownerAddress, publisherName } = useStationIdentity();

  const [tracks, setTracks] = useState<Track[]>(getLibraryTracks());
  const [loaded, setLoaded] = useState(getLibraryLoaded());
  const [loading, setLoading] = useState(getLibraryLoading());
  const [error, setError] = useState<string | null>(getLibraryError());
  const [incomplete, setIncomplete] = useState(getLibraryIncomplete());
  const [diagnostics, setDiagnostics] = useState<LibraryDiagnostic[]>(getLibraryDiagnostics());

  useEffect(() => {
    const unsubscribe = subscribeToLibrary(() => {
      setTracks(getLibraryTracks());
      setLoaded(getLibraryLoaded());
      setLoading(getLibraryLoading());
      setError(getLibraryError());
      setIncomplete(getLibraryIncomplete());
      setDiagnostics(getLibraryDiagnostics());
    });

    return unsubscribe;
  }, []);

  const refresh = useCallback(async () => {
    if (!ownerAddress || !publisherName) return;
    resetLibrary();
    setTracks([]);
    setLoaded(false);
    setLoading(true);
    setIncomplete(false);
    setDiagnostics([]);
    await loadLibrary(publisherName, ownerAddress);
  }, [ownerAddress, publisherName]);

  useEffect(() => {
    const action = getLibraryLoadAction(publisherName, ownerAddress);

    if (action === 'clear') {
      resetLibrary();
      setTracks([]);
      setLoaded(false);
      setLoading(false);
      setError(null);
      setIncomplete(false);
      setDiagnostics([]);
      return;
    }

    if (action === 'reuse') {
      setTracks(getLibraryTracks());
      setLoaded(getLibraryLoaded());
      setLoading(getLibraryLoading());
      setError(getLibraryError());
      setIncomplete(getLibraryIncomplete());
      setDiagnostics(getLibraryDiagnostics());
      return;
    }

    if (publisherName && ownerAddress) {
      resetLibrary();
      setTracks([]);
      setLoaded(false);
      setLoading(true);
      setError(null);
      setIncomplete(false);
      setDiagnostics([]);
      loadLibrary(publisherName, ownerAddress);
    }
  }, [ownerAddress, publisherName]);

  const removeTrack = useCallback(
    async (trackId: string) => {
      if (!publisherName) {
        throw new Error('A registered Qortium name is required.');
      }

      await removeTrackFromLibrary(trackId, publisherName);
    },
    [publisherName],
  );

  return {
    tracks,
    loaded,
    loading,
    error,
    incomplete,
    diagnostics,
    addTrack: publisherName
      ? (track: Track) => addTrackToLibrary(track, publisherName)
      : async () => {
          throw new Error('A registered Qortium name is required.');
        },
    createTrack: publisherName
      ? (input: CreateTrackInput) => createAndAddTrack(input, publisherName)
      : async () => {
          throw new Error('A registered Qortium name is required.');
        },
    editTrack: publisherName
      ? (trackId: string, input: EditTrackInput) => updateTrack(trackId, input, publisherName)
      : async () => {
          throw new Error('A registered Qortium name is required.');
        },
    removeTrack,
    getTrack: getTrackById,
    refresh,
  };
}
