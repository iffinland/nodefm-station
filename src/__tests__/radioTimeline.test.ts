/* ============================================================
 * NodeFM Station — Radio Timeline Engine Tests
 *
 * Exercises the production pure timeline functions across
 * default-rotation, scheduled-event, upcoming, dynamic-occurrence,
 * malformed-input, and boundary cases.
 * ============================================================ */

import { describe, it, expect } from 'vitest';
import { createPlaylistVersion } from '../features/playlists/services/playlistService';
import { floorMod, getUpcomingTracks, resolveLiveState } from '../features/radio/timeline';
import type {
  DynamicProgramOccurrence,
  PlaylistVersion,
  ScheduleEvent,
  Station,
} from '../types/domain';
import type { TimelineInput } from '../features/radio/timeline';

const EPOCH = Date.parse('2026-01-01T00:00:00.000Z');

function version(
  playlistId: string,
  versionId: string,
  tracks: Array<{ trackId: string; durationMs: number }>,
  versionNumber = 1,
): PlaylistVersion {
  const result = createPlaylistVersion({
    playlistId,
    createdBy: 'owner',
    tracks,
  });

  if (!result.ok) {
    throw new Error(result.error);
  }

  return {
    ...result.version,
    versionId,
    versionNumber,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function station(overrides: Partial<Station> = {}): Station {
  return {
    schemaVersion: 1,
    stationId: 'station-1',
    name: 'NodeFM Test',
    ownerAddress: 'owner-address',
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

function scheduleEvent(overrides: Partial<ScheduleEvent> = {}): ScheduleEvent {
  return {
    schemaVersion: 1,
    eventId: 'event-1',
    title: 'Test Program',
    startUtc: new Date(EPOCH + 1_000_000).toISOString(),
    endUtc: new Date(EPOCH + 2_000_000).toISOString(),
    source: {
      type: 'playlist',
      playlistId: 'scheduled-playlist',
      playlistVersionId: 'scheduled-version',
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function input(overrides: Partial<TimelineInput> = {}): TimelineInput {
  return {
    station: station(),
    scheduleEvents: [],
    playlistVersions: {},
    dynamicOccurrences: {},
    ...overrides,
  };
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

describe('floorMod', () => {
  it('implements positive floor modulo for positive and negative values', () => {
    expect(floorMod(10, 7)).toBe(3);
    expect(floorMod(-1, 7)).toBe(6);
    expect(floorMod(-7, 7)).toBe(0);
    expect(floorMod(-8, 7)).toBe(6);
  });

  it('returns NaN for invalid moduli or values', () => {
    expect(floorMod(1, 0)).toBeNaN();
    expect(floorMod(1, -1)).toBeNaN();
    expect(floorMod(Number.NaN, 7)).toBeNaN();
    expect(floorMod(Infinity, 7)).toBeNaN();
  });
});

describe('default rotation', () => {
  const tracks = [
    { trackId: 'A', durationMs: 220_000 },
    { trackId: 'B', durationMs: 255_000 },
    { trackId: 'C', durationMs: 175_000 },
    { trackId: 'D', durationMs: 310_000 },
  ];
  const defaultVersion = version('default-playlist', 'default-version', tracks);
  const ctx = input({
    playlistVersions: { 'default-version': defaultVersion },
  });

  it('starts at the exact epoch on the first track', () => {
    const result = resolveLiveState(EPOCH, ctx);
    expect(result).toEqual(
      expect.objectContaining({
        status: 'ready',
        live: expect.objectContaining({
          mode: 'default-rotation',
          trackId: 'A',
          offsetMs: 0,
          trackIndex: 0,
          trackStartUtcMs: EPOCH,
          nextTransitionUtcMs: EPOCH + 220_000,
        }),
      }),
    );
  });

  it('handles the millisecond before epoch using floor-mod semantics', () => {
    const result = resolveLiveState(EPOCH - 1, ctx);
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;

    expect(result.live.trackId).toBe('D');
    expect(result.live.offsetMs).toBe(309_999);
    expect(result.live.nextTransitionUtcMs).toBe(EPOCH);
  });

  it.each([
    [EPOCH + 219_999, 'A', 219_999, EPOCH + 220_000],
    [EPOCH + 220_000, 'B', 0, EPOCH + 475_000],
    [EPOCH + 220_001, 'B', 1, EPOCH + 475_000],
    [EPOCH + 300_000, 'B', 80_000, EPOCH + 475_000],
    [EPOCH + 959_999, 'D', 309_999, EPOCH + 960_000],
    [EPOCH + 960_000, 'A', 0, EPOCH + 1_180_000],
  ])('resolves track boundaries and wrap at %s', (nowMs, trackId, offsetMs, nextTransition) => {
    const result = resolveLiveState(nowMs, ctx);
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.live.trackId).toBe(trackId);
    expect(result.live.offsetMs).toBe(offsetMs);
    expect(result.live.nextTransitionUtcMs).toBe(nextTransition);
  });

  it('handles many full rotations and unequal durations', () => {
    const rotations = 3;
    const nowMs = EPOCH + rotations * 960_000 + 220_000 + 12_345;
    const result = resolveLiveState(nowMs, ctx);
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.live.trackId).toBe('B');
    expect(result.live.offsetMs).toBe(12_345);
  });

  it('repeats one-track rotations at exact boundaries', () => {
    const oneTrack = version('one', 'one-version', [{ trackId: 'solo', durationMs: 5_000 }]);
    const oneCtx = input({
      station: station({
        defaultRotationPlaylistId: 'one',
        defaultRotationPlaylistVersionId: 'one-version',
      }),
      playlistVersions: { 'one-version': oneTrack },
    });

    expect(resolveLiveState(EPOCH, oneCtx)).toMatchObject({
      status: 'ready',
      live: { trackId: 'solo', offsetMs: 0 },
    });
    expect(resolveLiveState(EPOCH + 4_999, oneCtx)).toMatchObject({
      status: 'ready',
      live: { trackId: 'solo', offsetMs: 4_999 },
    });
    expect(resolveLiveState(EPOCH + 5_000, oneCtx)).toMatchObject({
      status: 'ready',
      live: { trackId: 'solo', offsetMs: 0 },
    });
  });

  it('is deterministic for repeated equal inputs', () => {
    const a = resolveLiveState(EPOCH + 123_456, ctx);
    const b = resolveLiveState(EPOCH + 123_456, ctx);
    expect(a).toEqual(b);
  });

  it('handles very large timestamps without losing modulo behavior', () => {
    const nowMs = EPOCH + 10_000_000_000_123;
    const result = resolveLiveState(nowMs, ctx);
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.live.offsetMs).toBeGreaterThanOrEqual(0);
    expect(result.live.offsetMs).toBeLessThan(defaultVersion.totalDurationMs);
  });

  it('reports no program when station config is absent', () => {
    const result = resolveLiveState(EPOCH, input({ station: null }));
    expect(result).toMatchObject({
      status: 'no-program',
      code: 'no-station-config',
    });
  });

  it('reports a data error when the default version is missing', () => {
    const result = resolveLiveState(EPOCH, input());
    expect(result).toMatchObject({
      status: 'error',
      code: 'no-default-playlist-version',
    });
  });

  it('reports invalid playlist versions explicitly', () => {
    const empty = {
      ...version('default-playlist', 'default-version', [{ trackId: 'A', durationMs: 1_000 }]),
      tracks: [],
      totalDurationMs: 0,
    };
    const invalid = {
      ...version('default-playlist', 'default-version', [{ trackId: 'A', durationMs: 1_000 }]),
      totalDurationMs: 999,
    } as PlaylistVersion;

    for (const playlistVersion of [empty, invalid]) {
      const result = resolveLiveState(
        EPOCH,
        input({ playlistVersions: { 'default-version': playlistVersion } }),
      );
      expect(result).toMatchObject({
        status: 'error',
        code: 'invalid-playlist-version',
      });
    }
  });

  it('reports a default version that belongs to a different playlist', () => {
    const wrongPlaylistVersion = version('other-playlist', 'default-version', [
      { trackId: 'A', durationMs: 1_000 },
    ]);
    const result = resolveLiveState(
      EPOCH,
      input({
        playlistVersions: { 'default-version': wrongPlaylistVersion },
      }),
    );

    expect(result).toMatchObject({
      status: 'error',
      code: 'invalid-playlist-version',
    });
  });
});

describe('scheduled playlist events', () => {
  const defaultVersion = version('default-playlist', 'default-version', [
    { trackId: 'fallback', durationMs: 60_000 },
  ]);

  function scheduledCtx(overrides: Partial<TimelineInput> = {}): TimelineInput {
    const scheduledVersion = version('scheduled-playlist', 'scheduled-version', [
      { trackId: 'S-A', durationMs: 300_000 },
      { trackId: 'S-B', durationMs: 200_000 },
    ]);

    return input({
      scheduleEvents: [scheduleEvent()],
      playlistVersions: {
        'default-version': defaultVersion,
        'scheduled-version': scheduledVersion,
      },
      ...overrides,
    });
  }

  it('uses default rotation before an event and switches exactly at event start', () => {
    const ctx = scheduledCtx();
    const eventStart = EPOCH + 1_000_000;

    expect(resolveLiveState(eventStart - 1, ctx)).toMatchObject({
      status: 'ready',
      live: { mode: 'default-rotation', trackId: 'fallback' },
    });
    expect(resolveLiveState(eventStart, ctx)).toMatchObject({
      status: 'ready',
      live: {
        mode: 'scheduled',
        trackId: 'S-A',
        offsetMs: 0,
        scheduleEventId: 'event-1',
        playlistVersionId: 'scheduled-version',
      },
    });
  });

  it('handles track boundaries and playlist looping inside an event', () => {
    const ctx = scheduledCtx();
    const eventStart = EPOCH + 1_000_000;

    expect(resolveLiveState(eventStart + 299_999, ctx)).toMatchObject({
      status: 'ready',
      live: { trackId: 'S-A', offsetMs: 299_999 },
    });
    expect(resolveLiveState(eventStart + 300_000, ctx)).toMatchObject({
      status: 'ready',
      live: { trackId: 'S-B', offsetMs: 0 },
    });
    expect(resolveLiveState(eventStart + 500_000, ctx)).toMatchObject({
      status: 'ready',
      live: { trackId: 'S-A', offsetMs: 0 },
    });
  });

  it('ends exactly at event end even when a track is cut mid-play', () => {
    const ctx = scheduledCtx();
    const eventEnd = EPOCH + 2_000_000;

    expect(resolveLiveState(eventEnd - 1, ctx)).toMatchObject({
      status: 'ready',
      live: { mode: 'scheduled', scheduleEventId: 'event-1' },
    });
    expect(resolveLiveState(eventEnd, ctx)).toMatchObject({
      status: 'ready',
      live: { mode: 'default-rotation', trackId: 'fallback' },
    });
    expect(resolveLiveState(eventEnd + 1, ctx)).toMatchObject({
      status: 'ready',
      live: { mode: 'default-rotation', trackId: 'fallback' },
    });
  });

  it('supports adjacent events without returning to default between them', () => {
    const second = scheduleEvent({
      eventId: 'event-2',
      title: 'Second',
      startUtc: iso(EPOCH + 2_000_000),
      endUtc: iso(EPOCH + 3_000_000),
      source: {
        type: 'playlist',
        playlistId: 'scheduled-playlist-2',
        playlistVersionId: 'scheduled-version-2',
      },
    });
    const secondVersion = version('scheduled-playlist-2', 'scheduled-version-2', [
      { trackId: 'NEXT', durationMs: 120_000 },
    ]);
    const ctx = scheduledCtx({
      scheduleEvents: [scheduleEvent(), second],
      playlistVersions: {
        'default-version': defaultVersion,
        'scheduled-version': version('scheduled-playlist', 'scheduled-version', [
          { trackId: 'S-A', durationMs: 300_000 },
          { trackId: 'S-B', durationMs: 200_000 },
        ]),
        'scheduled-version-2': secondVersion,
      },
    });

    expect(resolveLiveState(EPOCH + 1_999_999, ctx)).toMatchObject({
      status: 'ready',
      live: { scheduleEventId: 'event-1' },
    });
    expect(resolveLiveState(EPOCH + 2_000_000, ctx)).toMatchObject({
      status: 'ready',
      live: { scheduleEventId: 'event-2', trackId: 'NEXT' },
    });
  });

  it('fails safely on overlapping active events', () => {
    const overlap = scheduleEvent({
      eventId: 'event-overlap',
      startUtc: iso(EPOCH + 1_500_000),
      endUtc: iso(EPOCH + 2_500_000),
    });
    const ctx = scheduledCtx({ scheduleEvents: [scheduleEvent(), overlap] });

    expect(resolveLiveState(EPOCH + 1_600_000, ctx)).toMatchObject({
      status: 'error',
      code: 'schedule-overlap',
    });
  });

  it('fails safely on malformed future overlaps even before either event starts', () => {
    const first = scheduleEvent({
      eventId: 'future-1',
      startUtc: iso(EPOCH + 5_000_000),
      endUtc: iso(EPOCH + 6_000_000),
    });
    const second = scheduleEvent({
      eventId: 'future-2',
      startUtc: iso(EPOCH + 5_500_000),
      endUtc: iso(EPOCH + 6_500_000),
    });
    const ctx = scheduledCtx({ scheduleEvents: [first, second] });

    expect(resolveLiveState(EPOCH, ctx)).toMatchObject({
      status: 'error',
      code: 'schedule-overlap',
    });
  });

  it('reports missing referenced playlist versions', () => {
    const ctx = scheduledCtx({
      playlistVersions: { 'default-version': defaultVersion },
    });

    expect(resolveLiveState(EPOCH + 1_500_000, ctx)).toMatchObject({
      status: 'error',
      code: 'playlist-version-unavailable',
    });
  });

  it('reports malformed schedule intervals', () => {
    const malformed = scheduleEvent({
      startUtc: iso(EPOCH + 2_000_000),
      endUtc: iso(EPOCH + 1_000_000),
    });
    const ctx = scheduledCtx({ scheduleEvents: [malformed] });

    expect(resolveLiveState(EPOCH, ctx)).toMatchObject({
      status: 'error',
      code: 'malformed-schedule-event',
    });
  });

  it('reports a scheduled version that belongs to a different playlist', () => {
    const wrongVersion = version('other-playlist', 'scheduled-version', [
      { trackId: 'S-A', durationMs: 300_000 },
    ]);
    const ctx = scheduledCtx({
      playlistVersions: {
        'default-version': defaultVersion,
        'scheduled-version': wrongVersion,
      },
    });

    expect(resolveLiveState(EPOCH + 1_500_000, ctx)).toMatchObject({
      status: 'error',
      code: 'invalid-playlist-version',
    });
  });
});

describe('dynamic program occurrence timeline', () => {
  const occurrence: DynamicProgramOccurrence = {
    schemaVersion: 1,
    occurrenceId: 'occurrence-1',
    programDefinitionId: 'request-show-1',
    scheduleEventId: 'event-1',
    startUtc: iso(EPOCH + 1_000_000),
    endUtc: iso(EPOCH + 2_000_000),
    generatedAt: '2026-01-01T00:00:00.000Z',
    tracks: [
      { trackId: 'L1', durationMs: 120_000, source: 'liked' },
      { trackId: 'F1', durationMs: 120_000, source: 'fallback' },
    ],
    seed: 'deterministic-seed',
  };

  const event = scheduleEvent({
    source: { type: 'dynamic-program', programDefinitionId: 'request-show-1' },
  });

  it('plays a resolved immutable occurrence as a scheduled timeline', () => {
    const ctx = input({
      scheduleEvents: [event],
      playlistVersions: {},
      dynamicOccurrences: { 'occurrence-1': occurrence },
    });
    const result = resolveLiveState(EPOCH + 1_000_000, ctx);

    expect(result).toMatchObject({
      status: 'ready',
      live: {
        mode: 'scheduled',
        trackId: 'L1',
        dynamicOccurrenceId: 'occurrence-1',
        scheduleEventId: 'event-1',
      },
    });
  });

  it('reports a missing occurrence', () => {
    const ctx = input({
      scheduleEvents: [event],
      playlistVersions: {},
      dynamicOccurrences: {},
    });

    expect(resolveLiveState(EPOCH + 1_500_000, ctx)).toMatchObject({
      status: 'error',
      code: 'dynamic-occurrence-unavailable',
    });
  });

  it('reports a mismatched occurrence', () => {
    const ctx = input({
      scheduleEvents: [event],
      playlistVersions: {},
      dynamicOccurrences: {
        'occurrence-1': {
          ...occurrence,
          startUtc: iso(EPOCH + 1_100_000),
        },
      },
    });

    expect(resolveLiveState(EPOCH + 1_500_000, ctx)).toMatchObject({
      status: 'error',
      code: 'invalid-dynamic-occurrence',
    });
  });

  it('rejects an occurrence that references a different dynamic program', () => {
    const ctx = input({
      scheduleEvents: [event],
      playlistVersions: {},
      dynamicOccurrences: {
        'occurrence-1': {
          ...occurrence,
          programDefinitionId: 'different-request-show',
        },
      },
    });

    expect(resolveLiveState(EPOCH + 1_500_000, ctx)).toMatchObject({
      status: 'error',
      code: 'invalid-dynamic-occurrence',
    });
  });
});

describe('upcoming track resolution', () => {
  const defaultVersion = version('default-playlist', 'default-version', [
    { trackId: 'A', durationMs: 60_000 },
    { trackId: 'B', durationMs: 60_000 },
    { trackId: 'C', durationMs: 60_000 },
  ]);

  it('returns the next tracks in the same default rotation', () => {
    const result = getUpcomingTracks(
      EPOCH + 10_000,
      4,
      input({
        playlistVersions: { 'default-version': defaultVersion },
      }),
    );

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.tracks.map((track) => track.trackId)).toEqual(['B', 'C', 'A', 'B']);
    expect(result.tracks.map((track) => track.expectedStartUtcMs)).toEqual([
      EPOCH + 60_000,
      EPOCH + 120_000,
      EPOCH + 180_000,
      EPOCH + 240_000,
    ]);
  });

  it('continues across an event boundary that cuts a track short', () => {
    const scheduledVersion = version('scheduled-playlist', 'scheduled-version', [
      { trackId: 'S-A', durationMs: 60_000 },
      { trackId: 'S-B', durationMs: 60_000 },
    ]);
    const event = scheduleEvent({
      startUtc: iso(EPOCH + 60_000),
      endUtc: iso(EPOCH + 100_000),
    });
    const ctx = input({
      scheduleEvents: [event],
      playlistVersions: {
        'default-version': defaultVersion,
        'scheduled-version': scheduledVersion,
      },
    });

    const result = getUpcomingTracks(EPOCH + 70_000, 3, ctx);
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;

    expect(result.tracks).toMatchObject([
      { trackId: 'C', expectedStartUtcMs: EPOCH + 120_000 },
      { trackId: 'A', expectedStartUtcMs: EPOCH + 180_000 },
      { trackId: 'B', expectedStartUtcMs: EPOCH + 240_000 },
    ]);
  });

  it('returns an empty list for zero count', () => {
    expect(
      getUpcomingTracks(
        EPOCH,
        0,
        input({
          playlistVersions: { 'default-version': defaultVersion },
        }),
      ),
    ).toEqual({ status: 'ready', tracks: [] });
  });
});

describe('timeline invariants', () => {
  const versionA = version('default-playlist', 'default-version', [
    { trackId: 'A', durationMs: 123_000 },
    { trackId: 'B', durationMs: 77_000 },
    { trackId: 'C', durationMs: 200_000 },
  ]);
  const ctx = input({ playlistVersions: { 'default-version': versionA } });

  it('keeps the elapsed offset inside the selected track duration', () => {
    for (let offset = -10_000; offset < 10_000; offset += 97) {
      const result = resolveLiveState(EPOCH + offset, ctx);
      expect(result.status).toBe('ready');
      if (result.status !== 'ready') continue;

      const track = versionA.tracks[result.live.trackIndex];
      expect(result.live.trackId).toBe(track.trackId);
      expect(result.live.offsetMs).toBeGreaterThanOrEqual(0);
      expect(result.live.offsetMs).toBeLessThan(track.durationMs);
    }
  });

  it('adds full rotation durations without changing rotation position', () => {
    const base = resolveLiveState(EPOCH + 42_000, ctx);
    const shifted = resolveLiveState(EPOCH + 42_000 + 7 * versionA.totalDurationMs, ctx);

    if (base.status !== 'ready' || shifted.status !== 'ready') {
      throw new Error('Both timeline results should be ready.');
    }

    expect(shifted.live).toMatchObject({
      trackId: base.live.trackId,
      trackIndex: base.live.trackIndex,
      offsetMs: base.live.offsetMs,
      mode: base.live.mode,
      playlistVersionId: base.live.playlistVersionId,
    });
  });
});
