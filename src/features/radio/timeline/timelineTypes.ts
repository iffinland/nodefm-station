/* ============================================================
 * NodeFM Station — Radio Timeline Types
 *
 * Pure domain result/input types for the deterministic radio
 * timeline. These types intentionally avoid React, QDN, and
 * audio concerns.
 * ============================================================ */

import type {
  DynamicProgramOccurrence,
  PlaylistVersion,
  PlaylistVersionTrack,
  ScheduleEvent,
  Station,
} from '../../../types/domain';

export type RadioMode = 'scheduled' | 'default-rotation';

export type LiveState = {
  mode: RadioMode;
  trackId: string;
  offsetMs: number;

  sourceStartUtcMs: number;
  sourceEndUtcMs?: number;

  scheduleEventId?: string;
  playlistVersionId?: string;
  dynamicOccurrenceId?: string;
  playlistId?: string;
  programTitle?: string;

  trackIndex: number;
  trackStartUtcMs: number;
  trackEndUtcMs: number;
  nextTransitionUtcMs: number | null;
};

export type UpcomingTrack = {
  trackId: string;
  durationMs: number;
  expectedStartUtcMs: number;
  mode: RadioMode;
  scheduleEventId?: string;
  playlistVersionId?: string;
  dynamicOccurrenceId?: string;
  programTitle?: string;
};

export type TimelineErrorCode =
  | 'no-station-config'
  | 'no-default-playlist-version'
  | 'playlist-version-unavailable'
  | 'invalid-playlist-version'
  | 'malformed-station-config'
  | 'malformed-schedule-event'
  | 'schedule-overlap'
  | 'dynamic-occurrence-unavailable'
  | 'invalid-dynamic-occurrence';

export type TimelineFailure = {
  status: 'no-program' | 'error';
  code: TimelineErrorCode;
  message: string;
};

export type TimelineSuccess = {
  status: 'ready';
  live: LiveState;
};

export type TimelineResult = TimelineSuccess | TimelineFailure;

export type TimelineInput = {
  station: Station | null;
  scheduleEvents: readonly ScheduleEvent[];
  playlistVersions: Readonly<Record<string, PlaylistVersion>>;
  dynamicOccurrences: Readonly<Record<string, DynamicProgramOccurrence>>;
};

export type PlaybackSourceTimeline = {
  kind: 'playlist' | 'dynamic-occurrence';
  sourceStartUtcMs: number;
  sourceEndUtcMs?: number;
  tracks: readonly PlaylistVersionTrack[];
  playlistId?: string;
  playlistVersionId?: string;
  dynamicOccurrenceId?: string;
  scheduleEventId?: string;
  programTitle?: string;
};

export type UpcomingResult =
  | {
      status: 'ready';
      tracks: UpcomingTrack[];
    }
  | TimelineFailure;
