/* ============================================================
 * NodeFM Station — useListenerUploads Hook
 *
 * React state bridge for the current listener's published Tracks.
 * Station moderation is displayed as separate informational state.
 * ============================================================ */

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../app/providers/authContext';
import { useStationIdentity } from '../station/useStationIdentity';
import {
  getListenerUploads,
  getListenerUploadsError,
  getListenerUploadsIncomplete,
  getListenerUploadsLoadAction,
  getListenerUploadsLoaded,
  getListenerUploadsLoading,
  loadListenerUploads,
  resetListenerUploads,
  subscribeToListenerUploads,
  type ListenerUpload,
} from './services/listenerUploadsStore';

export type UseListenerUploadsResult = {
  uploads: ListenerUpload[];
  loaded: boolean;
  loading: boolean;
  incomplete: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

export function useListenerUploads(): UseListenerUploadsResult {
  const { auth, ownerName } = useAuth();
  const { ownerAddress: stationOwnerAddress, publisherName: stationPublisherName } =
    useStationIdentity();
  const ownerAddress = auth.status === 'authenticated' ? auth.address : null;

  const [uploads, setUploads] = useState<ListenerUpload[]>(getListenerUploads());
  const [loaded, setLoaded] = useState(getListenerUploadsLoaded());
  const [loading, setLoading] = useState(getListenerUploadsLoading());
  const [incomplete, setIncomplete] = useState(getListenerUploadsIncomplete());
  const [error, setError] = useState<string | null>(getListenerUploadsError());

  useEffect(() => {
    const unsubscribe = subscribeToListenerUploads(() => {
      setUploads(getListenerUploads());
      setLoaded(getListenerUploadsLoaded());
      setLoading(getListenerUploadsLoading());
      setIncomplete(getListenerUploadsIncomplete());
      setError(getListenerUploadsError());
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    const action = getListenerUploadsLoadAction(
      ownerName,
      ownerAddress,
      stationPublisherName,
      stationOwnerAddress,
    );

    if (action === 'clear') {
      resetListenerUploads();
      setUploads([]);
      setLoaded(false);
      setLoading(false);
      setIncomplete(false);
      setError(null);
      return;
    }

    if (action === 'reuse') {
      setUploads(getListenerUploads());
      setLoaded(getListenerUploadsLoaded());
      setLoading(getListenerUploadsLoading());
      setIncomplete(getListenerUploadsIncomplete());
      setError(getListenerUploadsError());
      return;
    }

    if (ownerName && ownerAddress && stationPublisherName && stationOwnerAddress) {
      resetListenerUploads();
      setUploads([]);
      setLoaded(false);
      setLoading(true);
      setIncomplete(false);
      setError(null);
      loadListenerUploads(ownerName, ownerAddress, stationPublisherName, stationOwnerAddress);
    }
  }, [ownerName, ownerAddress, stationOwnerAddress, stationPublisherName]);

  const refresh = useCallback(async () => {
    if (!ownerName || !ownerAddress || !stationPublisherName || !stationOwnerAddress) return;

    await loadListenerUploads(
      ownerName,
      ownerAddress,
      stationPublisherName,
      stationOwnerAddress,
      true,
    );
  }, [ownerAddress, ownerName, stationOwnerAddress, stationPublisherName]);

  return { uploads, loaded, loading, incomplete, error, refresh };
}
