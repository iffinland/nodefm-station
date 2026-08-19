/* ============================================================
 * NodeFM Station — useNotices Hook
 *
 * Loads station notices for the active station publisher name.
 * Public notices are station-scoped rather than account-scoped.
 * ============================================================ */

import { useCallback, useEffect, useState } from 'react';
import { useStation } from '../station';
import type { StationNotice } from '../../types/domain';
import {
  getNoticeDiagnostics,
  getNoticeError,
  getNoticeIncomplete,
  getNoticeLoaded,
  getNoticeLoading,
  getNoticeRecords,
  loadNotices,
  refreshNotices,
  saveNotice,
  deleteNotice,
  subscribeToNoticeStore,
} from './services/noticeStore';

export type UseNoticesResult = {
  notices: StationNotice[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
  incomplete: boolean;
  diagnosticsCount: number;
  refresh: () => Promise<void>;
  saveNotice: (notice: StationNotice) => Promise<StationNotice>;
  deleteNotice: (noticeId: string) => Promise<void>;
};

export function useNotices(): UseNoticesResult {
  const { publisherName, station, isOwner } = useStation();

  const [loaded, setLoaded] = useState(getNoticeLoaded());
  const [loading, setLoading] = useState(getNoticeLoading());
  const [error, setError] = useState<string | null>(getNoticeError());
  const [incomplete, setIncomplete] = useState(getNoticeIncomplete());
  const [diagnosticsCount, setDiagnosticsCount] = useState(getNoticeDiagnostics().length);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const unsubscribe = subscribeToNoticeStore(() => {
      setLoaded(getNoticeLoaded());
      setLoading(getNoticeLoading());
      setError(getNoticeError());
      setIncomplete(getNoticeIncomplete());
      setDiagnosticsCount(getNoticeDiagnostics().length);
      setRevision((value) => value + 1);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    void loadNotices(publisherName);
  }, [publisherName]);

  const refresh = useCallback(async () => {
    await refreshNotices(publisherName);
  }, [publisherName]);

  const handleSaveNotice = useCallback(
    async (notice: StationNotice) => {
      if (!isOwner || !station?.ownerAddress) {
        throw new Error('Only the station owner can manage station notices.');
      }

      if (!publisherName) {
        throw new Error('A registered Qortium name is required to manage station notices.');
      }

      return saveNotice(notice, publisherName, station.ownerAddress, station.ownerAddress);
    },
    [isOwner, publisherName, station?.ownerAddress],
  );

  const handleDeleteNotice = useCallback(
    async (noticeId: string) => {
      if (!isOwner || !station?.ownerAddress) {
        throw new Error('Only the station owner can manage station notices.');
      }

      if (!publisherName) {
        throw new Error('A registered Qortium name is required to manage station notices.');
      }

      await deleteNotice(noticeId, publisherName, station.ownerAddress, station.ownerAddress);
    },
    [isOwner, publisherName, station?.ownerAddress],
  );

  void revision;
  const notices = getNoticeRecords().map((record) => record.notice);

  return {
    notices,
    loaded,
    loading,
    error,
    incomplete,
    diagnosticsCount,
    refresh,
    saveNotice: handleSaveNotice,
    deleteNotice: handleDeleteNotice,
  };
}

export { getActiveNotices } from './services/noticeService';
