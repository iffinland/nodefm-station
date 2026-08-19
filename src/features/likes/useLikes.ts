/* ============================================================
 * NodeFM Station — useLikes Hook
 *
 * Loads public Like records once and derives current-user and
 * per-track aggregates. Account switching changes only the
 * current-user interpretation, never the public source records.
 * ============================================================ */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TrackLikeAggregate } from './services/likeService';
import { useAuth } from '../../app/providers/authContext';
import {
  getLikeDiagnostics,
  getLikeError,
  getLikeIncomplete,
  getLikeLoaded,
  getLikeLoading,
  getLikeRecords,
  getTrackLikeAggregate,
  isTrackLikedByUser,
  loadLikeRecords,
  refreshLikeRecords,
  setTrackLike,
  subscribeToLikeStore,
} from './services/likeStore';

export type UseLikesResult = {
  loaded: boolean;
  loading: boolean;
  error: string | null;
  incomplete: boolean;
  ready: boolean;
  diagnosticsCount: number;
  aggregates: Record<string, TrackLikeAggregate>;
  isLiked: (trackId: string) => boolean;
  getLikeCount: (trackId: string) => number;
  toggleLike: (trackId: string) => Promise<void>;
  refresh: () => Promise<void>;
};

export function useLikes(trackIds: readonly string[]): UseLikesResult {
  const { auth, ownerName } = useAuth();
  const userAddress = auth.status === 'authenticated' ? auth.address : null;

  const [loaded, setLoaded] = useState(getLikeLoaded());
  const [loading, setLoading] = useState(getLikeLoading());
  const [error, setError] = useState<string | null>(getLikeError());
  const [incomplete, setIncomplete] = useState(getLikeIncomplete());
  const [diagnosticsCount, setDiagnosticsCount] = useState(getLikeDiagnostics().length);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const unsubscribe = subscribeToLikeStore(() => {
      setLoaded(getLikeLoaded());
      setLoading(getLikeLoading());
      setError(getLikeError());
      setIncomplete(getLikeIncomplete());
      setDiagnosticsCount(getLikeDiagnostics().length);
      setRevision((value) => value + 1);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    void loadLikeRecords();
  }, []);

  const uniqueTrackIds = useMemo(
    () => [...new Set(trackIds.filter((trackId) => trackId.trim()))],
    [trackIds],
  );

  const aggregates = useMemo(() => {
    void revision;
    const records = getLikeRecords();
    const result: Record<string, TrackLikeAggregate> = {};

    for (const trackId of uniqueTrackIds) {
      result[trackId] = getTrackLikeAggregate(trackId, records);
    }

    return result;
  }, [uniqueTrackIds, revision]);

  const isLiked = useCallback(
    (trackId: string) => {
      void revision;
      return isTrackLikedByUser(trackId, userAddress, getLikeRecords());
    },
    [userAddress, revision],
  );

  const getLikeCount = useCallback(
    (trackId: string) => aggregates[trackId]?.count ?? 0,
    [aggregates],
  );

  const toggleLike = useCallback(
    async (trackId: string) => {
      if (!ownerName || !userAddress) {
        throw new Error('A registered Qortium name and selected account are required to Like.');
      }

      const currentLiked = isTrackLikedByUser(trackId, userAddress, getLikeRecords());
      await setTrackLike(trackId, currentLiked ? 'inactive' : 'active', ownerName, userAddress);
    },
    [ownerName, userAddress],
  );

  const refresh = useCallback(async () => {
    await refreshLikeRecords();
  }, []);

  return {
    loaded,
    loading,
    error,
    incomplete,
    ready: loaded && !loading && !error && !incomplete,
    diagnosticsCount,
    aggregates,
    isLiked,
    getLikeCount,
    toggleLike,
    refresh,
  };
}

export { getTrackLikeAggregate } from './services/likeStore';
