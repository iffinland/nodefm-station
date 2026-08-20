/* ============================================================
 * NodeFM Station — PlaylistVersion Reference Safety Tests
 * ============================================================ */

import { describe, expect, it } from 'vitest';
import {
  findPlaylistVersionReferences,
  PlaylistVersionReferencedError,
} from '../features/playlists/services/playlistVersionReferenceService';
import type {
  DynamicProgramOccurrence,
  Playlist,
  ScheduleEvent,
  ScheduleRecurrence,
  Station,
} from '../types/domain';

function playlist(overrides: Partial<Playlist> = {}): Playlist {
  return {
    schemaVersion: 1,
    playlistId: 'pl1',
    ownerAddress: 'Q-owner',
    title: 'Playlist',
    visibility: 'private',
    latestVersionId: 'v-latest',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function scheduleEvent(overrides: Partial<ScheduleEvent> = {}): ScheduleEvent {
  return {
    schemaVersion: 1,
    eventId: 'ev1',
    title: 'Scheduled Show',
    startUtc: '2026-01-15T18:00:00.000Z',
    endUtc: '2026-01-15T19:00:00.000Z',
    source: {
      type: 'playlist',
      playlistId: 'pl1',
      playlistVersionId: 'v-scheduled',
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function recurrence(overrides: Partial<ScheduleRecurrence> = {}): ScheduleRecurrence {
  return {
    schemaVersion: 1,
    recurrenceId: 'rec1',
    ownerAddress: 'Q-owner',
    title: 'Weekly Show',
    source: {
      type: 'playlist',
      playlistId: 'pl1',
      playlistVersionId: 'v-recurring',
    },
    timezone: 'Europe/Helsinki',
    frequency: 'weekly',
    localStartTime: '18:00',
    durationMs: 60 * 60 * 1000,
    daysOfWeek: [5],
    activeFromLocalDate: '2026-01-01',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function station(overrides: Partial<Station> = {}): Station {
  return {
    schemaVersion: 1,
    stationId: 'station-1',
    name: 'NodeFM',
    publisherName: 'NodeFM',
    ownerAddress: 'Q-owner',
    timezone: 'Europe/Helsinki',
    defaultRotationPlaylistId: 'pl1',
    defaultRotationPlaylistVersionId: 'v-default',
    stationEpochUtc: '2026-01-01T00:00:00.000Z',
    messagingEnabled: true,
    tipsEnabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function occurrence(overrides: Partial<DynamicProgramOccurrence> = {}): DynamicProgramOccurrence {
  return {
    schemaVersion: 1,
    occurrenceId: 'occ1',
    programDefinitionId: 'prog1',
    scheduleEventId: 'ev-dynamic',
    startUtc: '2026-01-15T20:00:00.000Z',
    endUtc: '2026-01-15T20:30:00.000Z',
    generatedAt: '2026-01-15T19:59:00.000Z',
    tracks: [{ trackId: 't1', durationMs: 60_000, source: 'fallback' }],
    seed: 'seed',
    ...overrides,
  };
}

describe('findPlaylistVersionReferences', () => {
  it('returns no references for a genuinely unused historical version', () => {
    const references = findPlaylistVersionReferences({
      versionId: 'v-old',
      playlists: [playlist()],
      scheduleEvents: [scheduleEvent()],
      scheduleRecurrences: [recurrence()],
      station: station(),
      occurrences: [occurrence()],
    });

    expect(references).toEqual([]);
  });

  it('flags the logical latest version', () => {
    const references = findPlaylistVersionReferences({
      versionId: 'v-latest',
      playlists: [playlist()],
      scheduleEvents: [],
      scheduleRecurrences: [],
    });

    expect(references).toContainEqual(
      expect.objectContaining({ kind: 'latest-version', id: 'pl1' }),
    );
  });

  it('flags scheduled and recurring playlist references', () => {
    const references = findPlaylistVersionReferences({
      versionId: 'v-scheduled',
      playlists: [],
      scheduleEvents: [scheduleEvent()],
      scheduleRecurrences: [recurrence()],
    });

    expect(references).toContainEqual(
      expect.objectContaining({ kind: 'schedule-event', id: 'ev1' }),
    );

    const recurring = findPlaylistVersionReferences({
      versionId: 'v-recurring',
      playlists: [],
      scheduleEvents: [],
      scheduleRecurrences: [recurrence()],
    });

    expect(recurring).toContainEqual(
      expect.objectContaining({ kind: 'schedule-recurrence', id: 'rec1' }),
    );
  });

  it('flags the station default rotation version', () => {
    const references = findPlaylistVersionReferences({
      versionId: 'v-default',
      playlists: [],
      scheduleEvents: [],
      scheduleRecurrences: [],
      station: station(),
    });

    expect(references).toContainEqual(
      expect.objectContaining({ kind: 'station-default-rotation', id: 'station-1' }),
    );
  });

  it('keeps the explicit reference error useful', () => {
    const error = new PlaylistVersionReferencedError([
      { kind: 'schedule-event', id: 'ev1', label: 'Scheduled Show' },
    ]);

    expect(error.message).toContain('Scheduled Show');
    expect(error.references).toHaveLength(1);
  });
});
