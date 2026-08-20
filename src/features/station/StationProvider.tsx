/* ============================================================
 * NodeFM Station — Station Provider
 *
 * Loads the singleton station config from QDN and exposes
 * station metadata plus owner authorization.
 * ============================================================ */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '../../app/providers/authContext';
import { isStationOwner } from '../../qortium/auth';
import { NODEFM_APP_NAME, getCanonicalNodeFmAppIdentity } from '../../qortium/navigation';
import type { Station } from '../../types/domain';
import { StationContext, type StationContextValue } from './stationContext';
import {
  createStation,
  editStation,
  type CreateStationInput,
  type EditStationInput,
  type StationSaveInput,
} from './services/stationService';
import {
  getStation,
  getStationError,
  getStationLoadAction,
  getStationLoaded,
  getStationLoading,
  getStationPublisherName,
  loadStationConfig,
  resetStationStore,
  saveStationConfig,
  subscribeToStationStore,
} from './services/stationStore';

export function StationProvider({ children }: { children: ReactNode }) {
  const { auth } = useAuth();
  const userAddress = auth.status === 'authenticated' ? auth.address : null;

  const [station, setStation] = useState<Station | null>(getStation());
  const [loaded, setLoaded] = useState(getStationLoaded());
  const [loading, setLoading] = useState(getStationLoading());
  const [error, setError] = useState<string | null>(getStationError());
  const [publisherName, setPublisherName] = useState<string | null>(getStationPublisherName());

  useEffect(() => {
    const unsubscribe = subscribeToStationStore(() => {
      setStation(getStation());
      setLoaded(getStationLoaded());
      setLoading(getStationLoading());
      setError(getStationError());
      setPublisherName(getStationPublisherName());
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    // The canonical NodeFM station config is published under the APP name,
    // never under the selected account's primary name. This keeps the clean
    // reset from accidentally resolving an old test identity.
    const action = getStationLoadAction(NODEFM_APP_NAME);

    if (action === 'reuse') {
      setStation(getStation());
      setLoaded(getStationLoaded());
      setLoading(getStationLoading());
      setError(getStationError());
      setPublisherName(getStationPublisherName());
      return;
    }

    resetStationStore();
    setStation(null);
    setLoaded(false);
    setLoading(true);
    setError(null);
    setPublisherName(null);
    loadStationConfig(NODEFM_APP_NAME);
  }, []);

  const refresh = useCallback(async () => {
    resetStationStore();
    setStation(null);
    setLoaded(false);
    setLoading(true);
    setError(null);
    setPublisherName(null);
    await loadStationConfig(NODEFM_APP_NAME);
  }, []);

  const saveStation = useCallback(
    async (input: StationSaveInput) => {
      if (!userAddress) {
        throw new Error('An authenticated account is required to publish station configuration.');
      }

      const appIdentity = getCanonicalNodeFmAppIdentity();
      const publisherName = station?.publisherName?.trim() || appIdentity.name;

      const nextStation = station
        ? editStation(station, input as EditStationInput)
        : createStation({
            ...(input as Omit<CreateStationInput, 'publisherName' | 'ownerAddress' | 'ownerName'>),
            ownerAddress: userAddress,
            publisherName,
          });

      return saveStationConfig(nextStation, nextStation.publisherName);
    },
    [userAddress, station],
  );

  const isOwner = isStationOwner(userAddress, station ? station.ownerAddress : userAddress);

  const value: StationContextValue = {
    station,
    loaded,
    loading,
    error,
    publisherName,
    isOwner,
    saveStation,
    refresh,
  };

  return <StationContext.Provider value={value}>{children}</StationContext.Provider>;
}
