/* ============================================================
 * NodeFM Station — Deterministic Playback Shuffle Tests
 *
 * Covers the deterministic shuffle primitive, scheduled
 * occurrence permutations, AutoDJ session permutations, hard
 * boundaries, mid-session join math, and admin draft reorder
 * helpers.
 * ============================================================ */

import { describe, expect, it } from 'vitest';
import {
  avoidImmediateTrackRepeat,
  buildAutoDjSessionPermutationSeed,
  buildScheduledPlaylistPermutationSeed,
  permutePlaylistVersionTracks,
  resolveLiveState,
} from '../features/radio/timeline';
import { rotateArray, shuffleArray, shuffleDeterministic } from '../utils/deterministicShuffle';
import {
  createPlaylistVersion,
  createTrackSnapshot,
} from '../features/playlists/services/playlistService';
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
    createdBy: 'owner',
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
    ownerAddress: 'owner',
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

function scheduleEvent(
  eventId: string,
  startMs: number,
  endMs: number,
  playlistVersionId = 'scheduled-version',
  playlistId = 'scheduled-playlist',
): ScheduleEvent {
  return {
    schemaVersion: 1,
    eventId,
    title: 'Scheduled',
    startUtc: new Date(startMs).toISOString(),
    endUtc: new Date(endMs).toISOString(),
    source: {
      type: 'playlist',
      playlistId,
      playlistVersionId,
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
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

describe('deterministic shuffle primitive', () => {
  const values = ['A', 'B', 'C', 'D', 'E'];

  it('returns the same order for the same seed', () => {
    const first = shuffleDeterministic(values, 'same-seed');
    const second = shuffleDeterministic(values, 'same-seed');
    expect(second).toEqual(first);
  });

  it('returns a different order for a different seed', () => {
    const first = shuffleDeterministic(values, 'seed-a');
    const second = shuffleDeterministic(values, 'seed-b');
    expect(second).not.toEqual(first);
  });

  it('preserves exact membership and duplicate counts', () => {
    const duplicates = ['A', 'A', 'B', 'C'];
    const result = shuffleDeterministic(duplicates, 'duplicates');
    expect([...result].sort()).toEqual(['A', 'A', 'B', 'C']);
  });

  it('is safe for empty and one-track inputs', () => {
    expect(shuffleDeterministic([], 'empty')).toEqual([]);
    expect(shuffleDeterministic(['solo'], 'solo')).toEqual(['solo']);
  });

  it('does not mutate the input array', () => {
    const inputValues = [...values];
    shuffleDeterministic(inputValues, 'immutable');
    expect(inputValues).toEqual(values);
  });
});

describe('scheduled playlist permutation', () => {
  const scheduledVersion = version('scheduled-playlist', 'scheduled-version', [
    { trackId: 'A', durationMs: 200_000 },
    { trackId: 'B', durationMs: 150_000 },
    { trackId: 'C', durationMs: 250_000 },
    { trackId: 'D', durationMs: 100_000 },
  ]);
  const defaultVersion = version('default-playlist', 'default-version', [
    { trackId: 'fallback', durationMs: 60_000 },
  ]);
  const originalOrder = scheduledVersion.tracks.map((track) => track.trackId);

  it('keeps the stored PlaylistVersion order unchanged', () => {
    const ctx = input({
      scheduleEvents: [scheduleEvent('ev-1', EPOCH + 60_000, EPOCH + 260_000)],
      playlistVersions: {
        'default-version': defaultVersion,
        'scheduled-version': scheduledVersion,
      },
    });

    const live = resolveLiveState(EPOCH + 100_000, ctx);
    expect(live.status).toBe('ready');
    expect(scheduledVersion.tracks.map((track) => track.trackId)).toEqual(originalOrder);
  });

  it('derives a stable order for one occurrence', () => {
    const event = scheduleEvent('ev-1', EPOCH + 60_000, EPOCH + 260_000);
    const ctx = input({
      scheduleEvents: [event],
      playlistVersions: {
        'default-version': defaultVersion,
        'scheduled-version': scheduledVersion,
      },
    });
    const expectedOrder = permutePlaylistVersionTracks(
      scheduledVersion.tracks,
      buildScheduledPlaylistPermutationSeed(
        'station-1',
        'scheduled-version',
        event.eventId,
        EPOCH + 60_000,
      ),
    );

    const first = resolveLiveState(EPOCH + 60_000, ctx);
    const second = resolveLiveState(EPOCH + 60_000, ctx);
    expect(first).toEqual(second);
    if (first.status !== 'ready') throw new Error('Expected ready live state');
    expect(first.live.trackId).toBe(expectedOrder[0].trackId);
  });

  it('uses a different deterministic order for a different occurrence start', () => {
    const firstEvent = scheduleEvent('ev-shared', EPOCH + 60_000, EPOCH + 260_000);
    const secondEvent = scheduleEvent('ev-shared', EPOCH + 360_000, EPOCH + 560_000);

    const firstOrder = permutePlaylistVersionTracks(
      scheduledVersion.tracks,
      buildScheduledPlaylistPermutationSeed(
        'station-1',
        'scheduled-version',
        firstEvent.eventId,
        EPOCH + 60_000,
      ),
    );
    const secondOrder = permutePlaylistVersionTracks(
      scheduledVersion.tracks,
      buildScheduledPlaylistPermutationSeed(
        'station-1',
        'scheduled-version',
        secondEvent.eventId,
        EPOCH + 360_000,
      ),
    );

    expect(secondOrder.map((track) => track.trackId)).not.toEqual(
      firstOrder.map((track) => track.trackId),
    );
  });

  it('maps a mid-occurrence join to the correct track and exact offset', () => {
    const event = scheduleEvent('ev-1', EPOCH + 60_000, EPOCH + 1_000_000);
    const ctx = input({
      scheduleEvents: [event],
      playlistVersions: {
        'default-version': defaultVersion,
        'scheduled-version': scheduledVersion,
      },
    });
    const expectedOrder = permutePlaylistVersionTracks(
      scheduledVersion.tracks,
      buildScheduledPlaylistPermutationSeed(
        'station-1',
        'scheduled-version',
        event.eventId,
        EPOCH + 60_000,
      ),
    );
    const joinMs = EPOCH + 60_000 + 225_000;
    const live = resolveLiveState(joinMs, ctx);

    expect(live.status).toBe('ready');
    if (live.status !== 'ready') return;

    expect(live.live.trackId).toBe(expectedOrder[1].trackId);
    expect(live.live.offsetMs).toBe(225_000 - expectedOrder[0].durationMs);
  });

  it('keeps event endUtc as a hard boundary', () => {
    const ctx = input({
      scheduleEvents: [scheduleEvent('ev-1', EPOCH + 60_000, EPOCH + 260_000)],
      playlistVersions: {
        'default-version': defaultVersion,
        'scheduled-version': scheduledVersion,
      },
    });

    expect(resolveLiveState(EPOCH + 259_999, ctx)).toMatchObject({
      status: 'ready',
      live: { mode: 'scheduled', scheduleEventId: 'ev-1' },
    });
    expect(resolveLiveState(EPOCH + 260_000, ctx)).toMatchObject({
      status: 'ready',
      live: { mode: 'default-rotation' },
    });
  });
});

describe('AutoDJ session permutation', () => {
  const defaultVersion = version('default-playlist', 'default-version', [
    { trackId: 'A', durationMs: 100_000 },
    { trackId: 'B', durationMs: 120_000 },
    { trackId: 'C', durationMs: 90_000 },
    { trackId: 'D', durationMs: 110_000 },
  ]);
  const scheduledVersion = version('scheduled-playlist', 'scheduled-version', [
    { trackId: 'X', durationMs: 50_000 },
  ]);

  function autoDjCtx(scheduleEvents: ScheduleEvent[]): TimelineInput {
    return input({
      scheduleEvents,
      playlistVersions: {
        'default-version': defaultVersion,
        'scheduled-version': scheduledVersion,
      },
    });
  }

  it('starts a fresh deterministic session after a schedule ends', () => {
    const event = scheduleEvent('ev-1', EPOCH + 60_000, EPOCH + 110_000);
    const ctx = autoDjCtx([event]);
    const boundary = EPOCH + 110_000;
    const sessionOrder = permutePlaylistVersionTracks(
      defaultVersion.tracks,
      buildAutoDjSessionPermutationSeed('station-1', 'default-version', boundary),
    );

    const afterEnd = resolveLiveState(boundary, ctx);
    expect(afterEnd.status).toBe('ready');
    if (afterEnd.status !== 'ready') return;
    expect(afterEnd.live.mode).toBe('default-rotation');
    expect(afterEnd.live.trackId).toBe(sessionOrder[0].trackId);
    expect(afterEnd.live.offsetMs).toBe(0);
  });

  it('keeps refreshes and mid-session joins on the same order', () => {
    const event = scheduleEvent('ev-1', EPOCH + 60_000, EPOCH + 110_000);
    const ctx = autoDjCtx([event]);
    const boundary = EPOCH + 110_000;
    const sessionOrder = permutePlaylistVersionTracks(
      defaultVersion.tracks,
      buildAutoDjSessionPermutationSeed('station-1', 'default-version', boundary),
    );
    const joinMs = boundary + 170_000;
    const first = resolveLiveState(joinMs, ctx);
    const second = resolveLiveState(joinMs, ctx);

    expect(first).toEqual(second);
    expect(first.status).toBe('ready');
    if (first.status !== 'ready') return;

    expect(first.live.trackId).toBe(sessionOrder[1].trackId);
    expect(first.live.offsetMs).toBe(170_000 - sessionOrder[0].durationMs);
  });

  it('uses a different order for a later AutoDJ session', () => {
    const firstEvent = scheduleEvent('ev-1', EPOCH + 60_000, EPOCH + 110_000);
    const secondEvent = scheduleEvent('ev-2', EPOCH + 200_000, EPOCH + 250_000);
    const firstOrder = permutePlaylistVersionTracks(
      defaultVersion.tracks,
      buildAutoDjSessionPermutationSeed('station-1', 'default-version', EPOCH + 110_000),
    );
    const secondOrder = permutePlaylistVersionTracks(
      defaultVersion.tracks,
      buildAutoDjSessionPermutationSeed('station-1', 'default-version', EPOCH + 250_000),
    );

    expect(secondOrder.map((track) => track.trackId)).not.toEqual(
      firstOrder.map((track) => track.trackId),
    );
    expect(resolveLiveState(EPOCH + 250_000, autoDjCtx([firstEvent, secondEvent]))).toMatchObject({
      status: 'ready',
      live: { mode: 'default-rotation' },
    });
  });

  it('does not immediately repeat the previous scheduled track', () => {
    const boundary = findBoundaryWhereAutoDjStartsWithX();
    const event = scheduleEvent('anti-repeat', boundary - 10_000, boundary);
    const repeatAwareDefaultVersion = version('default-playlist', 'default-version', [
      { trackId: 'X', durationMs: 100_000 },
      { trackId: 'Y', durationMs: 100_000 },
    ]);
    const ctx = input({
      scheduleEvents: [event],
      playlistVersions: {
        'default-version': repeatAwareDefaultVersion,
        'scheduled-version': scheduledVersion,
      },
      dynamicOccurrences: {},
    });
    const live = resolveLiveState(boundary, ctx);

    expect(live.status).toBe('ready');
    if (live.status !== 'ready') return;
    expect(live.live.trackId).not.toBe('X');
  });

  it('allows a one-track AutoDJ library to repeat by necessity', () => {
    const oneTrack = version('default-playlist', 'default-version', [
      { trackId: 'X', durationMs: 50_000 },
    ]);
    const ctx = input({
      station: station(),
      scheduleEvents: [scheduleEvent('ev-1', EPOCH + 60_000, EPOCH + 110_000)],
      playlistVersions: {
        'default-version': oneTrack,
        'scheduled-version': scheduledVersion,
      },
      dynamicOccurrences: {},
    });

    const live = resolveLiveState(EPOCH + 110_000, ctx);
    expect(live).toMatchObject({
      status: 'ready',
      live: { trackId: 'X' },
    });
  });
});

describe('admin draft reorder helpers', () => {
  const tracks = [
    { trackId: 'A', durationMs: 1_000 },
    { trackId: 'B', durationMs: 2_000 },
    { trackId: 'C', durationMs: 3_000 },
  ];

  it('shuffle preserves membership and returns a new array', () => {
    const result = shuffleArray(tracks);
    expect([...result].sort((a, b) => a.trackId.localeCompare(b.trackId))).toEqual(
      [...tracks].sort((a, b) => a.trackId.localeCompare(b.trackId)),
    );
    expect(result).not.toBe(tracks);
  });

  it('rotates a draft left by one', () => {
    expect(rotateArray(tracks, 1).map((track) => track.trackId)).toEqual(['B', 'C', 'A']);
    expect(rotateArray([], 1)).toEqual([]);
    expect(rotateArray([tracks[0]], 1)).toEqual([tracks[0]]);
  });

  it('saves the current shuffled draft order as a version snapshot', () => {
    const shuffled = shuffleArray(tracks);
    const snapshot = createTrackSnapshot(shuffled);

    expect(snapshot.map((track) => track.trackId)).toEqual(shuffled.map((track) => track.trackId));
    expect(tracks.map((track) => track.trackId)).toEqual(['A', 'B', 'C']);
  });
});

function findBoundaryWhereAutoDjStartsWithX(): number {
  const defaultVersion = version('default-playlist', 'default-version', [
    { trackId: 'X', durationMs: 100_000 },
    { trackId: 'Y', durationMs: 100_000 },
  ]);

  for (let boundary = EPOCH + 10_001; boundary < EPOCH + 100_000; boundary += 1) {
    const order = permutePlaylistVersionTracks(
      defaultVersion.tracks,
      buildAutoDjSessionPermutationSeed('station-1', 'default-version', boundary),
    );

    if (order[0].trackId === 'X') {
      return boundary;
    }
  }

  throw new Error('Unable to find an anti-repeat test boundary.');
}

describe('avoidImmediateTrackRepeat primitive', () => {
  const tracks = [
    { trackId: 'X', durationMs: 1_000 },
    { trackId: 'Y', durationMs: 2_000 },
    { trackId: 'Z', durationMs: 3_000 },
  ];

  it('rotates away from a repeated previous track', () => {
    expect(avoidImmediateTrackRepeat(tracks, 'X').map((track) => track.trackId)).toEqual([
      'Y',
      'Z',
      'X',
    ]);
  });

  it('leaves the order unchanged when the first track is eligible', () => {
    expect(avoidImmediateTrackRepeat(tracks, 'Y')).toEqual(tracks);
  });

  it('allows repeat when no alternative exists', () => {
    expect(avoidImmediateTrackRepeat([{ trackId: 'X', durationMs: 1_000 }], 'X')).toEqual([
      { trackId: 'X', durationMs: 1_000 },
    ]);
  });
});
