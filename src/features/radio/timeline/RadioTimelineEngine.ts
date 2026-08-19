/* ============================================================
 * NodeFM Station — Radio Timeline Engine
 *
 * Deterministic, pure domain implementation. All inputs are
 * explicit and no wall clock is read here.
 * ============================================================ */

import type { DynamicProgramOccurrence, ScheduleEvent, Station } from '../../../types/domain';
import type {
  LiveState,
  PlaybackSourceTimeline,
  TimelineFailure,
  TimelineInput,
  TimelineResult,
  UpcomingResult,
  UpcomingTrack,
} from './timelineTypes';
import {
  floorMod,
  getPlaylistDurationMs,
  isValidDynamicOccurrenceRecord,
  isValidPlaylistVersionRecord,
  locateTrackAtPosition,
  parseUtcTimestampMs,
} from './timelineMath';

type ActiveEventResolution =
  | { status: 'none' }
  | { status: 'ok'; event: ScheduleEvent }
  | { status: 'error'; failure: TimelineFailure };

type SourceResolution =
  { status: 'ok'; source: PlaybackSourceTimeline } | { status: 'error'; failure: TimelineFailure };

function failure(
  status: TimelineFailure['status'],
  code: TimelineFailure['code'],
  message: string,
): TimelineFailure {
  return { status, code, message };
}

function validateStationConfig(station: Station | null): TimelineFailure | null {
  if (!station) {
    return failure('no-program', 'no-station-config', 'No station configuration is available.');
  }

  if (
    typeof station.defaultRotationPlaylistVersionId !== 'string' ||
    station.defaultRotationPlaylistVersionId.trim() === '' ||
    parseUtcTimestampMs(station.stationEpochUtc) === null
  ) {
    return failure(
      'error',
      'malformed-station-config',
      'Station configuration is missing a valid default rotation version or epoch.',
    );
  }

  return null;
}

function validateScheduleEvent(event: ScheduleEvent): TimelineFailure | null {
  const start = parseUtcTimestampMs(event.startUtc);
  const end = parseUtcTimestampMs(event.endUtc);

  if (start === null || end === null || start >= end) {
    return failure(
      'error',
      'malformed-schedule-event',
      `Schedule event ${event.eventId} has an invalid UTC interval.`,
    );
  }

  if (
    !event.source ||
    (event.source.type !== 'playlist' && event.source.type !== 'dynamic-program')
  ) {
    return failure(
      'error',
      'malformed-schedule-event',
      `Schedule event ${event.eventId} has an invalid source.`,
    );
  }

  if (event.source.type === 'playlist') {
    if (
      typeof event.source.playlistId !== 'string' ||
      event.source.playlistId.trim() === '' ||
      typeof event.source.playlistVersionId !== 'string' ||
      event.source.playlistVersionId.trim() === ''
    ) {
      return failure(
        'error',
        'malformed-schedule-event',
        `Schedule event ${event.eventId} has an invalid playlist source.`,
      );
    }
  } else if (
    typeof event.source.programDefinitionId !== 'string' ||
    event.source.programDefinitionId.trim() === ''
  ) {
    return failure(
      'error',
      'malformed-schedule-event',
      `Schedule event ${event.eventId} has an invalid dynamic-program source.`,
    );
  }

  return null;
}

function resolveActiveScheduleEvent(
  events: readonly ScheduleEvent[],
  nowUtcMs: number,
): ActiveEventResolution {
  for (const event of events) {
    const invalid = validateScheduleEvent(event);
    if (invalid) {
      return { status: 'error', failure: invalid };
    }
  }

  const sorted = [...events].sort((left, right) => {
    const startDelta = parseUtcTimestampMs(left.startUtc)! - parseUtcTimestampMs(right.startUtc)!;
    if (startDelta !== 0) {
      return startDelta;
    }

    return parseUtcTimestampMs(left.endUtc)! - parseUtcTimestampMs(right.endUtc)!;
  });

  for (let index = 1; index < sorted.length; index += 1) {
    const previousEnd = parseUtcTimestampMs(sorted[index - 1].endUtc)!;
    const currentStart = parseUtcTimestampMs(sorted[index].startUtc)!;

    if (currentStart < previousEnd) {
      return {
        status: 'error',
        failure: failure(
          'error',
          'schedule-overlap',
          'Malformed schedule data: schedule events overlap.',
        ),
      };
    }
  }

  const active = events.filter((event) => {
    const start = parseUtcTimestampMs(event.startUtc)!;
    const end = parseUtcTimestampMs(event.endUtc)!;
    return start <= nowUtcMs && nowUtcMs < end;
  });

  if (active.length === 0) {
    return { status: 'none' };
  }

  if (active.length > 1) {
    return {
      status: 'error',
      failure: failure(
        'error',
        'schedule-overlap',
        'Malformed schedule data: multiple events are active at the same UTC instant.',
      ),
    };
  }

  return { status: 'ok', event: active[0] };
}

function resolvePlaylistSource(
  versionId: string,
  playlistVersions: TimelineInput['playlistVersions'],
  scheduleEvent: ScheduleEvent,
): SourceResolution {
  const version = playlistVersions[versionId];

  if (!version) {
    return {
      status: 'error',
      failure: failure(
        'error',
        'playlist-version-unavailable',
        `Scheduled playlist version is unavailable: ${versionId}`,
      ),
    };
  }

  if (!isValidPlaylistVersionRecord(version) || version.versionId !== versionId) {
    return {
      status: 'error',
      failure: failure(
        'error',
        'invalid-playlist-version',
        `Playlist version is invalid for scheduled playback: ${versionId}`,
      ),
    };
  }

  if (
    scheduleEvent.source.type === 'playlist' &&
    version.playlistId !== scheduleEvent.source.playlistId
  ) {
    return {
      status: 'error',
      failure: failure(
        'error',
        'invalid-playlist-version',
        `Scheduled playlist version does not match event playlist: ${versionId}`,
      ),
    };
  }

  return {
    status: 'ok',
    source: {
      kind: 'playlist',
      sourceStartUtcMs: parseUtcTimestampMs(scheduleEvent.startUtc)!,
      sourceEndUtcMs: parseUtcTimestampMs(scheduleEvent.endUtc)!,
      tracks: version.tracks,
      playlistId: version.playlistId,
      playlistVersionId: version.versionId,
      scheduleEventId: scheduleEvent.eventId,
      programTitle: scheduleEvent.title,
    },
  };
}

function resolveDynamicSource(
  scheduleEvent: ScheduleEvent,
  dynamicOccurrences: TimelineInput['dynamicOccurrences'],
): SourceResolution {
  const occurrences = Object.values(dynamicOccurrences).filter(
    (occurrence): occurrence is DynamicProgramOccurrence =>
      !!occurrence &&
      typeof occurrence === 'object' &&
      (occurrence as Partial<DynamicProgramOccurrence>).scheduleEventId === scheduleEvent.eventId,
  );

  if (occurrences.length === 0) {
    return {
      status: 'error',
      failure: failure(
        'error',
        'dynamic-occurrence-unavailable',
        `Dynamic program occurrence is unavailable for event ${scheduleEvent.eventId}.`,
      ),
    };
  }

  if (occurrences.length > 1) {
    return {
      status: 'error',
      failure: failure(
        'error',
        'invalid-dynamic-occurrence',
        `Multiple dynamic program occurrences reference event ${scheduleEvent.eventId}.`,
      ),
    };
  }

  const occurrence = occurrences[0];

  if (!isValidDynamicOccurrenceRecord(occurrence)) {
    return {
      status: 'error',
      failure: failure(
        'error',
        'invalid-dynamic-occurrence',
        `Dynamic program occurrence is malformed for event ${scheduleEvent.eventId}.`,
      ),
    };
  }

  const eventStart = parseUtcTimestampMs(scheduleEvent.startUtc)!;
  const eventEnd = parseUtcTimestampMs(scheduleEvent.endUtc)!;
  const occurrenceStart = parseUtcTimestampMs(occurrence.startUtc);
  const occurrenceEnd = parseUtcTimestampMs(occurrence.endUtc);

  if (
    occurrenceStart !== eventStart ||
    occurrenceEnd !== eventEnd ||
    occurrence.tracks.length === 0
  ) {
    return {
      status: 'error',
      failure: failure(
        'error',
        'invalid-dynamic-occurrence',
        `Dynamic program occurrence does not match event ${scheduleEvent.eventId}.`,
      ),
    };
  }

  return {
    status: 'ok',
    source: {
      kind: 'dynamic-occurrence',
      sourceStartUtcMs: occurrenceStart,
      sourceEndUtcMs: occurrenceEnd,
      tracks: occurrence.tracks,
      dynamicOccurrenceId: occurrence.occurrenceId,
      scheduleEventId: scheduleEvent.eventId,
      programTitle: scheduleEvent.title,
    },
  };
}

function resolveDefaultSource(
  station: Station,
  playlistVersions: TimelineInput['playlistVersions'],
): SourceResolution {
  const versionId = station.defaultRotationPlaylistVersionId;
  const version = playlistVersions[versionId];

  if (!version) {
    return {
      status: 'error',
      failure: failure(
        'error',
        'no-default-playlist-version',
        `Default rotation playlist version is unavailable: ${versionId}`,
      ),
    };
  }

  if (!isValidPlaylistVersionRecord(version) || version.versionId !== versionId) {
    return {
      status: 'error',
      failure: failure(
        'error',
        'invalid-playlist-version',
        `Default rotation playlist version is invalid: ${versionId}`,
      ),
    };
  }

  if (version.playlistId !== station.defaultRotationPlaylistId) {
    return {
      status: 'error',
      failure: failure(
        'error',
        'invalid-playlist-version',
        `Default rotation playlist version does not match station playlist: ${versionId}`,
      ),
    };
  }

  return {
    status: 'ok',
    source: {
      kind: 'playlist',
      sourceStartUtcMs: parseUtcTimestampMs(station.stationEpochUtc)!,
      sourceEndUtcMs: undefined,
      tracks: version.tracks,
      playlistId: version.playlistId,
      playlistVersionId: version.versionId,
    },
  };
}

function resolveActiveSource(nowUtcMs: number, input: TimelineInput): SourceResolution {
  const stationError = validateStationConfig(input.station);
  if (stationError) {
    return { status: 'error', failure: stationError };
  }

  const station = input.station!;
  const eventResolution = resolveActiveScheduleEvent(input.scheduleEvents, nowUtcMs);

  if (eventResolution.status === 'error') {
    return { status: 'error', failure: eventResolution.failure };
  }

  if (eventResolution.status === 'ok') {
    const event = eventResolution.event;
    return event.source.type === 'playlist'
      ? resolvePlaylistSource(event.source.playlistVersionId, input.playlistVersions, event)
      : resolveDynamicSource(event, input.dynamicOccurrences);
  }

  return resolveDefaultSource(station, input.playlistVersions);
}

function buildLiveState(source: PlaybackSourceTimeline, nowUtcMs: number): TimelineResult {
  const totalDurationMs = getPlaylistDurationMs(source.tracks);

  if (!Number.isFinite(totalDurationMs) || totalDurationMs <= 0) {
    return {
      status: 'error',
      code: 'invalid-playlist-version',
      message: 'Playback source has no valid playable duration.',
    };
  }

  const elapsedWithinSourceMs = nowUtcMs - source.sourceStartUtcMs;
  const loopIndex = Math.floor(elapsedWithinSourceMs / totalDurationMs);
  const positionMs = floorMod(elapsedWithinSourceMs, totalDurationMs);
  const located = locateTrackAtPosition(source.tracks, positionMs);

  if (!located) {
    return {
      status: 'error',
      code: 'invalid-playlist-version',
      message: 'Unable to locate a playable track in the playback source.',
    };
  }

  const cycleStartUtcMs = source.sourceStartUtcMs + loopIndex * totalDurationMs;
  const trackStartUtcMs = cycleStartUtcMs + located.trackStartWithinSourceMs;
  const trackEndUtcMs = cycleStartUtcMs + located.trackEndWithinSourceMs;
  const nextTransitionUtcMs =
    source.sourceEndUtcMs === undefined
      ? trackEndUtcMs
      : Math.min(trackEndUtcMs, source.sourceEndUtcMs);

  const live: LiveState = {
    mode: source.sourceEndUtcMs === undefined ? 'default-rotation' : 'scheduled',
    trackId: located.track.trackId,
    offsetMs: positionMs - located.trackStartWithinSourceMs,
    sourceStartUtcMs: source.sourceStartUtcMs,
    sourceEndUtcMs: source.sourceEndUtcMs,
    scheduleEventId: source.scheduleEventId,
    playlistVersionId: source.playlistVersionId,
    dynamicOccurrenceId: source.dynamicOccurrenceId,
    playlistId: source.playlistId,
    programTitle: source.programTitle,
    trackIndex: located.trackIndex,
    trackStartUtcMs,
    trackEndUtcMs,
    nextTransitionUtcMs,
  };

  return { status: 'ready', live };
}

export function resolveLiveState(nowUtcMs: number, input: TimelineInput): TimelineResult {
  if (!Number.isFinite(nowUtcMs) || !Number.isInteger(nowUtcMs)) {
    return {
      status: 'error',
      code: 'malformed-station-config',
      message: 'nowUtcMs must be a finite integer UTC timestamp.',
    };
  }

  const source = resolveActiveSource(nowUtcMs, input);
  return source.status === 'error' ? source.failure : buildLiveState(source.source, nowUtcMs);
}

export function getCurrentScheduleEvent(
  nowUtcMs: number,
  input: TimelineInput,
): ScheduleEvent | null {
  const resolution = resolveActiveScheduleEvent(input.scheduleEvents, nowUtcMs);
  return resolution.status === 'ok' ? resolution.event : null;
}

function upcomingTrackFromSource(
  source: PlaybackSourceTimeline,
  startUtcMs: number,
): UpcomingTrack | null {
  const totalDurationMs = getPlaylistDurationMs(source.tracks);
  if (!Number.isFinite(totalDurationMs) || totalDurationMs <= 0) {
    return null;
  }

  const positionMs = floorMod(startUtcMs - source.sourceStartUtcMs, totalDurationMs);
  const located = locateTrackAtPosition(source.tracks, positionMs);
  if (!located) {
    return null;
  }

  return {
    trackId: located.track.trackId,
    durationMs: located.track.durationMs,
    expectedStartUtcMs: startUtcMs,
    mode: source.sourceEndUtcMs === undefined ? 'default-rotation' : 'scheduled',
    scheduleEventId: source.scheduleEventId,
    playlistVersionId: source.playlistVersionId,
    dynamicOccurrenceId: source.dynamicOccurrenceId,
    programTitle: source.programTitle,
  };
}

export function getUpcomingTracks(
  nowUtcMs: number,
  count: number,
  input: TimelineInput,
): UpcomingResult {
  if (!Number.isFinite(nowUtcMs) || !Number.isInteger(nowUtcMs)) {
    return {
      status: 'error',
      code: 'malformed-station-config',
      message: 'nowUtcMs must be a finite integer UTC timestamp.',
    };
  }

  if (!Number.isInteger(count) || count < 0) {
    return {
      status: 'error',
      code: 'malformed-station-config',
      message: 'Upcoming track count must be a non-negative integer.',
    };
  }

  const tracks: UpcomingTrack[] = [];
  let cursorUtcMs = nowUtcMs;
  let iterations = 0;

  while (tracks.length < count) {
    iterations += 1;
    if (iterations > Math.max(count * 2 + 100, 1000)) {
      return {
        status: 'error',
        code: 'invalid-playlist-version',
        message: 'Upcoming timeline traversal did not converge.',
      };
    }

    const sourceResolution = resolveActiveSource(cursorUtcMs, input);
    if (sourceResolution.status === 'error') {
      return sourceResolution.failure;
    }

    const source = sourceResolution.source;
    const totalDurationMs = getPlaylistDurationMs(source.tracks);
    if (!Number.isFinite(totalDurationMs) || totalDurationMs <= 0) {
      return {
        status: 'error',
        code: 'invalid-playlist-version',
        message: 'Playback source has no valid playable duration.',
      };
    }

    const positionMs = floorMod(cursorUtcMs - source.sourceStartUtcMs, totalDurationMs);
    const located = locateTrackAtPosition(source.tracks, positionMs);
    if (!located) {
      return {
        status: 'error',
        code: 'invalid-playlist-version',
        message: 'Unable to locate a playable track while resolving upcoming tracks.',
      };
    }

    const loopIndex = Math.floor((cursorUtcMs - source.sourceStartUtcMs) / totalDurationMs);
    const cycleStartUtcMs = source.sourceStartUtcMs + loopIndex * totalDurationMs;
    const trackEndUtcMs = cycleStartUtcMs + located.trackEndWithinSourceMs;
    const nextStartUtcMs =
      source.sourceEndUtcMs === undefined
        ? trackEndUtcMs
        : Math.min(trackEndUtcMs, source.sourceEndUtcMs);

    if (source.sourceEndUtcMs !== undefined && nextStartUtcMs === source.sourceEndUtcMs) {
      cursorUtcMs = source.sourceEndUtcMs;
      continue;
    }

    const upcoming = upcomingTrackFromSource(source, nextStartUtcMs);
    if (!upcoming) {
      return {
        status: 'error',
        code: 'invalid-playlist-version',
        message: 'Unable to resolve an upcoming track from the active source.',
      };
    }

    tracks.push(upcoming);
    cursorUtcMs = nextStartUtcMs;
  }

  return { status: 'ready', tracks };
}
