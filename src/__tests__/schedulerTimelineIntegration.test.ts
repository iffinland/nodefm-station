/* ============================================================
 * NodeFM Station — Scheduler ↔ Timeline Integration Tests
 *
 * Uses production schedule creation/compilation plus the
 * production RadioTimelineEngine to prove concrete generated
 * events drive live state at exact boundaries.
 * ============================================================ */

import { describe, it, expect } from 'vitest';
import { createPlaylistVersion } from '../features/playlists/services/playlistService';
import { createScheduleEvent } from '../features/scheduling/services/scheduleService';
import { compileScheduleRecurrence } from '../features/scheduling/services/recurrenceCompiler';
import { resolveLiveState } from '../features/radio/timeline';
import type { PlaylistVersion, ScheduleEvent, Station } from '../types/domain';
import type { TimelineInput } from '../features/radio/timeline';

const EPOCH = Date.parse('2026-01-01T00:00:00.000Z');

function version(
  playlistId: string,
  versionId: string,
  tracks: Array<{ trackId: string; durationMs: number }>,
): PlaylistVersion {
  const result = createPlaylistVersion({
    playlistId,
    createdBy: 'Q-owner',
    tracks,
  });

  if (!result.ok) throw new Error(result.error);
  return { ...result.version, versionId };
}

function station(overrides: Partial<Station> = {}): Station {
  return {
    schemaVersion: 1,
    stationId: 'station-1',
    name: 'NodeFM',
    publisherName: 'NodeFM',
    ownerAddress: 'Q-owner',
    ownerName: 'Owner',
    timezone: 'Europe/Helsinki',
    defaultRotationPlaylistId: 'default-playlist',
    defaultRotationPlaylistVersionId: 'default-version',
    stationEpochUtc: '2026-01-01T00:00:00.000Z',
    messagingEnabled: false,
    tipsEnabled: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function playlistEvent(eventId: string, startUtcMs: number, endUtcMs: number): ScheduleEvent {
  return createScheduleEvent({
    title: eventId,
    startUtc: new Date(startUtcMs).toISOString(),
    endUtc: new Date(endUtcMs).toISOString(),
    source: {
      type: 'playlist',
      playlistId: 'scheduled-playlist',
      playlistVersionId: 'scheduled-version',
    },
  });
}

function input(events: ScheduleEvent[], versions: Record<string, PlaylistVersion>): TimelineInput {
  return {
    station: station(),
    scheduleEvents: events,
    playlistVersions: {
      'default-version': version('default-playlist', 'default-version', [
        { trackId: 'fallback', durationMs: 60_000 },
      ]),
      ...versions,
    },
    dynamicOccurrences: {},
  };
}

describe('scheduler-generated events drive the production timeline', () => {
  const scheduledVersion = version('scheduled-playlist', 'scheduled-version', [
    { trackId: 'S-A', durationMs: 300_000 },
    { trackId: 'S-B', durationMs: 200_000 },
  ]);

  it('switches exactly at T-1, T, T+1, end-1, end, and end+1', () => {
    const startMs = EPOCH + 1_000_000;
    const endMs = EPOCH + 2_000_000;
    const event = playlistEvent('event-1', startMs, endMs);
    const ctx = input([event], { 'scheduled-version': scheduledVersion });

    expect(resolveLiveState(startMs - 1, ctx)).toMatchObject({
      status: 'ready',
      live: { mode: 'default-rotation', trackId: 'fallback' },
    });
    expect(resolveLiveState(startMs, ctx)).toMatchObject({
      status: 'ready',
      live: {
        mode: 'scheduled',
        trackId: 'S-A',
        offsetMs: 0,
        scheduleEventId: event.eventId,
      },
    });
    expect(resolveLiveState(startMs + 1, ctx)).toMatchObject({
      status: 'ready',
      live: { mode: 'scheduled', trackId: 'S-A', offsetMs: 1 },
    });
    expect(resolveLiveState(endMs - 1, ctx)).toMatchObject({
      status: 'ready',
      live: { mode: 'scheduled', scheduleEventId: event.eventId },
    });
    expect(resolveLiveState(endMs, ctx)).toMatchObject({
      status: 'ready',
      live: { mode: 'default-rotation', trackId: 'fallback' },
    });
    expect(resolveLiveState(endMs + 1, ctx)).toMatchObject({
      status: 'ready',
      live: { mode: 'default-rotation', trackId: 'fallback' },
    });
  });

  it('uses adjacent concrete events without a fallback gap', () => {
    const first = playlistEvent('first', EPOCH + 1_000_000, EPOCH + 2_000_000);
    const second = playlistEvent('second', EPOCH + 2_000_000, EPOCH + 3_000_000);
    const ctx = input([first, second], {
      'scheduled-version': scheduledVersion,
    });

    expect(resolveLiveState(EPOCH + 1_999_999, ctx)).toMatchObject({
      status: 'ready',
      live: { scheduleEventId: first.eventId },
    });
    expect(resolveLiveState(EPOCH + 2_000_000, ctx)).toMatchObject({
      status: 'ready',
      live: { scheduleEventId: second.eventId, trackId: 'S-A', offsetMs: 0 },
    });
  });

  it('compiled recurrence events are concrete timeline inputs', () => {
    const recurrence = {
      schemaVersion: 1,
      recurrenceId: 'recurrence-1',
      ownerAddress: 'Q-owner',
      title: 'Daily Show',
      source: {
        type: 'playlist' as const,
        playlistId: 'scheduled-playlist',
        playlistVersionId: 'scheduled-version',
      },
      timezone: 'Europe/Helsinki',
      frequency: 'daily' as const,
      localStartTime: '20:00',
      durationMs: 30 * 60_000,
      activeFromLocalDate: '2026-01-01',
      activeUntilLocalDate: '2026-01-02',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const compiled = compileScheduleRecurrence(recurrence, Date.parse('2026-01-01T12:00:00.000Z'));

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const ctx = input(compiled.events, { 'scheduled-version': scheduledVersion });
    expect(resolveLiveState(Date.parse('2026-01-01T18:00:00.000Z'), ctx)).toMatchObject({
      status: 'ready',
      live: {
        mode: 'scheduled',
        scheduleEventId: compiled.events[0].eventId,
        programTitle: 'Daily Show',
      },
    });
  });
});
