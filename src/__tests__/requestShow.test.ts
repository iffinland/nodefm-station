/* ============================================================
 * NodeFM Station — Request Show Generator and Occurrence Tests
 *
 * Covers deterministic generation, liked/fallback policy, invalid
 * candidates, serialization, and production timeline integration.
 * ============================================================ */

import { describe, it, expect } from 'vitest';
import type { DynamicProgramDefinition, ScheduleEvent, Station, Track } from '../types/domain';
import {
  buildRequestShowSeed,
  deserializeDynamicProgramOccurrenceFromQdn,
  generateRequestShowOccurrence,
  serializeDynamicProgramOccurrenceForQdn,
} from '../features/dynamic-programs/request-show/requestShowService';
import { resolveLiveState } from '../features/radio/timeline';
import type { TimelineInput } from '../features/radio/timeline';

const EPOCH = Date.parse('2026-01-01T00:00:00.000Z');

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function track(trackId: string, durationMs: number): Track {
  return {
    schemaVersion: 1,
    trackId,
    ownerAddress: 'owner',
    title: `Track ${trackId}`,
    audio: { service: 'AUDIO', name: 'Owner', identifier: `audio-${trackId}` },
    durationMs,
    source: 'station-upload',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function definition(programDefinitionId = 'request-show-1'): DynamicProgramDefinition {
  return {
    schemaVersion: 1,
    programDefinitionId,
    type: 'request-show',
    title: 'Request Show',
    targetDurationMs: 30 * 60_000,
    ranking: { strategy: 'most-liked' },
    fallback: {
      enabled: true,
      source: 'station-library',
      strategy: 'deterministic-random',
    },
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function dynamicEvent(
  eventId: string,
  startUtcMs: number,
  endUtcMs: number,
  programDefinitionId = 'request-show-1',
): ScheduleEvent {
  return {
    schemaVersion: 1,
    eventId,
    title: 'Request Show',
    startUtc: iso(startUtcMs),
    endUtc: iso(endUtcMs),
    source: { type: 'dynamic-program', programDefinitionId },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function ranked(trackId: string, likeCount: number) {
  return {
    trackId,
    likeCount,
    likerAddresses: Array.from({ length: likeCount }, (_, i) => `a-${i}`),
  };
}

describe('Request Show generation', () => {
  const eligibleTracks = [
    track('L1', 60_000),
    track('L2', 120_000),
    track('F1', 180_000),
    track('F2', 240_000),
    track('F3', 300_000),
    track('F4', 360_000),
    track('F5', 600_000),
  ];
  const event = dynamicEvent('event-1', EPOCH + 1_000_000, EPOCH + 2_800_000);

  it('is deterministic for equal inputs', () => {
    const first = generateRequestShowOccurrence(
      event,
      definition(),
      eligibleTracks,
      [ranked('L1', 2), ranked('L2', 1)],
      '2026-01-01T00:00:00.000Z',
    );
    const second = generateRequestShowOccurrence(
      event,
      definition(),
      eligibleTracks,
      [ranked('L1', 2), ranked('L2', 1)],
      '2026-01-01T00:00:00.000Z',
    );

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.occurrence).toEqual(second.occurrence);
    expect(first.occurrence.seed).toBe(
      buildRequestShowSeed('request-show-1', 'event-1', event.startUtc),
    );
  });

  it('uses liked tracks first, then deterministic fallback', () => {
    const result = generateRequestShowOccurrence(
      event,
      definition(),
      eligibleTracks,
      [ranked('L2', 3), ranked('L1', 1)],
      '2026-01-01T00:00:00.000Z',
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.occurrence.tracks[0].trackId).toBe('L2');
    expect(result.occurrence.tracks[0].source).toBe('liked');
    expect(result.occurrence.tracks[1].trackId).toBe('L1');
    expect(result.occurrence.tracks[1].source).toBe('liked');
    expect(result.occurrence.tracks.slice(2).every((entry) => entry.source === 'fallback')).toBe(
      true,
    );
    expect(new Set(result.occurrence.tracks.map((entry) => entry.trackId)).size).toBe(
      result.occurrence.tracks.length,
    );
  });

  it('fills with fallback when liked tracks are insufficient or absent', () => {
    const someLikes = generateRequestShowOccurrence(
      event,
      definition(),
      eligibleTracks,
      [ranked('L1', 1)],
      '2026-01-01T00:00:00.000Z',
    );
    const zeroLikes = generateRequestShowOccurrence(
      event,
      definition(),
      eligibleTracks,
      [],
      '2026-01-01T00:00:00.000Z',
    );

    expect(someLikes.ok).toBe(true);
    expect(zeroLikes.ok).toBe(true);
    if (!someLikes.ok || !zeroLikes.ok) return;

    expect(someLikes.occurrence.tracks.some((entry) => entry.source === 'fallback')).toBe(true);
    expect(zeroLikes.occurrence.tracks[0].source).toBe('fallback');
    expect(zeroLikes.occurrence.tracks.length).toBeGreaterThan(0);
  });

  it('excludes invalid durations and fails with no eligible tracks', () => {
    const invalid = track('bad', 0);
    const result = generateRequestShowOccurrence(
      event,
      definition(),
      [invalid],
      [ranked('bad', 1)],
      '2026-01-01T00:00:00.000Z',
    );

    expect(result).toMatchObject({
      ok: false,
      code: 'no-eligible-tracks',
    });
  });

  it('does not select duplicate tracks in the generated occurrence', () => {
    const result = generateRequestShowOccurrence(
      event,
      definition(),
      eligibleTracks,
      [ranked('F1', 2)],
      '2026-01-01T00:00:00.000Z',
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(new Set(result.occurrence.tracks.map((entry) => entry.trackId)).size).toBe(
      result.occurrence.tracks.length,
    );
  });

  it('rejects a schedule event that does not reference the definition', () => {
    const wrongEvent = dynamicEvent('event-2', EPOCH + 1_000_000, EPOCH + 2_800_000, 'other');
    const result = generateRequestShowOccurrence(
      wrongEvent,
      definition(),
      eligibleTracks,
      [],
      '2026-01-01T00:00:00.000Z',
    );

    expect(result).toMatchObject({
      ok: false,
      code: 'invalid-schedule-event',
    });
  });
});

describe('Request Show occurrence serialization and timeline', () => {
  const event = dynamicEvent('event-1', EPOCH + 1_000_000, EPOCH + 2_000_000);
  const tracks = [track('L1', 120_000), track('F1', 120_000), track('F2', 120_000)];

  it('round-trips an immutable occurrence payload', () => {
    const result = generateRequestShowOccurrence(
      event,
      definition(),
      tracks,
      [ranked('L1', 2)],
      '2026-01-01T00:00:00.000Z',
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const serialized = serializeDynamicProgramOccurrenceForQdn(result.occurrence);
    const parsed = deserializeDynamicProgramOccurrenceFromQdn(JSON.parse(serialized));
    expect(parsed).toEqual(result.occurrence);
  });

  it('plays the generated occurrence through the production timeline at exact boundaries', () => {
    const result = generateRequestShowOccurrence(
      event,
      definition(),
      tracks,
      [ranked('L1', 2)],
      '2026-01-01T00:00:00.000Z',
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const station: Station = {
      schemaVersion: 1,
      stationId: 'station-1',
      name: 'NodeFM',
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
    };
    const timeline: TimelineInput = {
      station,
      scheduleEvents: [event],
      playlistVersions: {},
      dynamicOccurrences: {
        [result.occurrence.occurrenceId]: result.occurrence,
      },
    };

    const eventStart = Date.parse(event.startUtc);
    const eventEnd = Date.parse(event.endUtc);

    expect(resolveLiveState(eventStart - 1, timeline).status).toBe('error');
    expect(resolveLiveState(eventStart, timeline)).toMatchObject({
      status: 'ready',
      live: {
        mode: 'scheduled',
        dynamicOccurrenceId: result.occurrence.occurrenceId,
        scheduleEventId: event.eventId,
      },
    });
    expect(resolveLiveState(eventEnd - 1, timeline)).toMatchObject({
      status: 'ready',
      live: { mode: 'scheduled', scheduleEventId: event.eventId },
    });
    expect(resolveLiveState(eventEnd, timeline).status).toBe('error');
  });
});
