/* ============================================================
 * NodeFM Station — Station Provider
 *
 * Loads the singleton station config from QDN and exposes
 * station metadata plus owner authorization.
 * ============================================================ */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '../../app/providers/authContext';
import { isStationOwner } from '../../qortium/auth';
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
  const { auth, ownerName } = useAuth();
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
    const action = getStationLoadAction(ownerName);

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
    loadStationConfig(ownerName);
  }, [ownerName]);

  const refresh = useCallback(async () => {
    resetStationStore();
    setStation(null);
    setLoaded(false);
    setLoading(true);
    setError(null);
    setPublisherName(null);
    await loadStationConfig(ownerName);
  }, [ownerName]);

  const saveStation = useCallback(
    async (input: StationSaveInput) => {
      if (!ownerName) {
        throw new Error('A registered Qortium name is required to publish station configuration.');
      }

      if (!userAddress) {
        throw new Error('An authenticated account is required to publish station configuration.');
      }

      const nextStation = station
        ? editStation(station, input as EditStationInput)
        : createStation({
            ...(input as Omit<CreateStationInput, 'ownerAddress' | 'ownerName'>),
            ownerAddress: userAddress,
            ownerName,
          });

      return saveStationConfig(nextStation, ownerName);
    },
    [ownerName, userAddress, station],
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
