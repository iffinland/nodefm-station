/* ============================================================
 * NodeFM Station — useRadioTimeline
 *
 * Combines loaded timeline data with the pure engine to produce
 * live state and enriched upcoming items. This hook does not
 * control the audio element.
 * ============================================================ */

import { useMemo } from 'react';
import type { Track } from '../../../types/domain';
import {
  getUpcomingTracks,
  resolveLiveState,
  type LiveState,
  type TimelineInput,
  type TimelineResult,
  type UpcomingTrack,
} from '../timeline';
import { useStation } from '../../station';
import { useNowUtcMs } from './useNowUtcMs';
import { useRadioTimelineData } from './useRadioTimelineData';

export type UpcomingTrackWithMetadata = UpcomingTrack & {
  title?: string;
  artist?: string;
  durationMs: number;
};

export type UseRadioTimelineResult = {
  stationLoaded: boolean;
  stationLoading: boolean;
  stationError: string | null;
  dataLoaded: boolean;
  dataLoading: boolean;
  dataError: string | null;
  nowUtcMs: number;
  liveResult: TimelineResult;
  currentTrack: Track | null;
  liveState: LiveState | null;
  upcoming: UpcomingTrackWithMetadata[];
  upcomingResult: ReturnType<typeof getUpcomingTracks>;
  refreshData: () => Promise<void>;
};

const UPCOMING_COUNT = 5;

export function useRadioTimeline(nowOverride?: number): UseRadioTimelineResult {
  const {
    station,
    loaded: stationLoaded,
    loading: stationLoading,
    error: stationError,
  } = useStation();
  const dataState = useRadioTimelineData();
  const clockNow = useNowUtcMs(1_000);
  const nowUtcMs = nowOverride ?? clockNow;

  const timelineInput: TimelineInput = useMemo(
    () => ({
      station,
      scheduleEvents: dataState.data?.scheduleEvents ?? [],
      playlistVersions: dataState.data?.playlistVersions ?? {},
      dynamicOccurrences: dataState.data?.dynamicOccurrences ?? {},
    }),
    [station, dataState.data],
  );

  const liveResult = useMemo(
    () => resolveLiveState(nowUtcMs, timelineInput),
    [nowUtcMs, timelineInput],
  );

  const upcomingResult = useMemo(
    () => getUpcomingTracks(nowUtcMs, UPCOMING_COUNT, timelineInput),
    [nowUtcMs, timelineInput],
  );

  const liveState = liveResult.status === 'ready' ? liveResult.live : null;
  const currentTrack =
    liveState && dataState.data?.tracks[liveState.trackId]
      ? dataState.data.tracks[liveState.trackId]
      : null;

  const upcoming = useMemo(() => {
    if (upcomingResult.status !== 'ready') {
      return [];
    }

    return upcomingResult.tracks.map((item) => {
      const track = dataState.data?.tracks[item.trackId];
      return {
        ...item,
        title: track?.title,
        artist: track?.artist,
        durationMs: item.durationMs,
      };
    });
  }, [upcomingResult, dataState.data]);

  return {
    stationLoaded,
    stationLoading,
    stationError,
    dataLoaded: dataState.loaded,
    dataLoading: dataState.loading,
    dataError: dataState.error,
    nowUtcMs,
    liveResult,
    currentTrack,
    liveState,
    upcoming,
    upcomingResult,
    refreshData: dataState.refresh,
  };
}
