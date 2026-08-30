/* ============================================================
 * NodeFM Station — useRadioTimelineData
 *
 * Loads immutable playlist versions/track metadata for the
 * configured station. The pure timeline calculation remains
 * separate from this data-loading hook.
 * ============================================================ */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useStation } from '../../station';
import { recordStartupEvent } from '../../../services/perf/startupDiagnostics';
import {
  getRadioTimelineData,
  getRadioTimelineDataError,
  getRadioTimelineDataLoaded,
  getRadioTimelineDataLoading,
  isRadioTimelineDataCurrent,
  loadRadioTimelineData,
  resetRadioTimelineData,
  subscribeToRadioTimelineData,
  type RadioTimelineData,
} from '../timeline/radioTimelineDataStore';

export type UseRadioTimelineDataResult = {
  data: RadioTimelineData | null;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

export function useRadioTimelineData(): UseRadioTimelineDataResult {
  const { station, loaded: stationLoaded, publisherName } = useStation();
  const [data, setData] = useState<RadioTimelineData | null>(getRadioTimelineData());
  const [loaded, setLoaded] = useState(getRadioTimelineDataLoaded());
  const [loading, setLoading] = useState(getRadioTimelineDataLoading());
  const [error, setError] = useState<string | null>(getRadioTimelineDataError());
  const timelineStartRecordedRef = useRef(false);
  const timelineReadyRecordedRef = useRef(false);

  useEffect(() => {
    const unsubscribe = subscribeToRadioTimelineData(() => {
      setData(getRadioTimelineData());
      setLoaded(getRadioTimelineDataLoaded());
      setLoading(getRadioTimelineDataLoading());
      setError(getRadioTimelineDataError());
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!stationLoaded || !station || !publisherName) {
      resetRadioTimelineData();
      setData(null);
      setLoaded(false);
      setLoading(false);
      setError(null);
      return;
    }

    if (isRadioTimelineDataCurrent(station, publisherName)) {
      setData(getRadioTimelineData());
      setLoaded(true);
      setLoading(false);
      setError(null);
      return;
    }

    resetRadioTimelineData();
    setData(null);
    setLoaded(false);
    setLoading(true);
    setError(null);
    loadRadioTimelineData(station, publisherName);
  }, [station, stationLoaded, publisherName]);

  useEffect(() => {
    if (loading && !timelineStartRecordedRef.current) {
      timelineStartRecordedRef.current = true;
      recordStartupEvent('TIMELINE_DATA_START');
    }

    if ((loaded || error) && !timelineReadyRecordedRef.current) {
      timelineReadyRecordedRef.current = true;
      recordStartupEvent('TIMELINE_DATA_READY', {
        completion: loaded ? 'success' : 'error',
        detail: error ?? undefined,
      });
    }
  }, [error, loaded, loading]);

  const refresh = useCallback(async () => {
    if (!station || !publisherName) {
      return;
    }

    resetRadioTimelineData();
    setData(null);
    setLoaded(false);
    setLoading(true);
    setError(null);
    await loadRadioTimelineData(station, publisherName);
  }, [station, publisherName]);

  return { data, loaded, loading, error, refresh };
}
