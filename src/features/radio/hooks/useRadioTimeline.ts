/* ============================================================
 * NodeFM Station — useRadioTimeline
 *
 * Combines loaded timeline data with the pure engine to produce
 * live state and enriched upcoming items. This hook does not
 * control the audio element.
 * ============================================================ */

import { useMemo } from 'react';
import type { PlaylistVersionTrack, ScheduleEvent, Track } from '../../../types/domain';
import {
  getUpcomingTracks,
  resolvePlaybackTrackOrder,
  resolveLiveState,
  type LiveState,
  type TimelineInput,
  type TimelineResult,
  type UpcomingTrack,
} from '../timeline';
import { useStation } from '../../station';
import { useNowUtcMs } from './useNowUtcMs';
import { useRadioTimelineData } from './useRadioTimelineData';
import type { LivePlaybackCandidate } from '../player/livePlaybackFallback';

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
  playbackCandidates: LivePlaybackCandidate[];
  missingTrackIds: string[];
  upcoming: UpcomingTrackWithMetadata[];
  upcomingResult: ReturnType<typeof getUpcomingTracks>;
  scheduleEvents: ScheduleEvent[];
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

  const playbackOrderResult = useMemo(
    () => resolvePlaybackTrackOrder(nowUtcMs, timelineInput),
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

  const playbackCandidates = useMemo(() => {
    if (playbackOrderResult.status !== 'ready' || !dataState.data) {
      return [];
    }

    const { order } = playbackOrderResult;
    const cycleStartUtcMs =
      order.source.sourceStartUtcMs + order.currentLoopIndex * order.totalDurationMs;
    let cursorUtcMs = cycleStartUtcMs;

    return order.tracks.map((track: PlaylistVersionTrack, index: number) => {
      const trackStartUtcMs = cursorUtcMs;
      const trackEndUtcMs = cursorUtcMs + track.durationMs;
      cursorUtcMs = trackEndUtcMs;

      return {
        trackId: track.trackId,
        durationMs: track.durationMs,
        metadata: dataState.data?.tracks[track.trackId] ?? null,
        trackIndex: index,
        trackStartUtcMs,
        trackEndUtcMs,
      };
    });
  }, [dataState.data, playbackOrderResult]);

  const upcoming = useMemo(() => {
    if (upcomingResult.status !== 'ready') {
      return [];
    }

    return upcomingResult.tracks.map((item) => {
      const track = dataState.data?.tracks[item.trackId];
      const isUnavailable = dataState.data?.unavailableTrackIds.includes(item.trackId) ?? false;

      return {
        ...item,
        title: track?.title ?? (isUnavailable ? 'Unavailable track' : undefined),
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
    playbackCandidates,
    missingTrackIds: dataState.data?.unavailableTrackIds ?? [],
    upcoming,
    upcomingResult,
    scheduleEvents: dataState.data?.scheduleEvents ?? [],
    refreshData: dataState.refresh,
  };
}
