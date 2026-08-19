/* ============================================================
 * NodeFM Station — Schedule Domain Tests
 *
 * Pure validation/conflict behavior for concrete schedule events
 * and recurrence authoring records.
 * ============================================================ */

import { describe, it, expect } from 'vitest';
import {
  createScheduleEvent,
  createScheduleRecurrence,
  editScheduleEvent,
  findScheduleConflicts,
  validateScheduleEvent,
  validateScheduleRecurrence,
  validateScheduleSet,
} from '../features/scheduling/services/scheduleService';
import type { ScheduleEvent, ScheduleRecurrence } from '../types/domain';

function makeEvent(overrides: Partial<ScheduleEvent> = {}): ScheduleEvent {
  return {
    schemaVersion: 1,
    eventId: 'event-1',
    title: 'Evening Rock',
    startUtc: '2026-01-15T18:00:00.000Z',
    endUtc: '2026-01-15T20:00:00.000Z',
    source: {
      type: 'playlist',
      playlistId: 'playlist-1',
      playlistVersionId: 'version-1',
    },
    createdAt: '2026-01-15T00:00:00.000Z',
    updatedAt: '2026-01-15T00:00:00.000Z',
    ...overrides,
  };
}

function makeRecurrence(overrides: Partial<ScheduleRecurrence> = {}): ScheduleRecurrence {
  return {
    schemaVersion: 1,
    recurrenceId: 'recurrence-1',
    ownerAddress: 'Q-owner',
    title: 'Request Show',
    source: {
      type: 'playlist',
      playlistId: 'playlist-1',
      playlistVersionId: 'version-1',
    },
    timezone: 'Europe/Helsinki',
    frequency: 'daily',
    localStartTime: '20:00',
    durationMs: 30 * 60_000,
    activeFromLocalDate: '2026-01-01',
    activeUntilLocalDate: '2026-02-01',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('schedule event validation', () => {
  it('accepts a valid event', () => {
    expect(validateScheduleEvent(makeEvent())).toEqual({ ok: true });
  });

  it('rejects invalid intervals and sources', () => {
    expect(
      validateScheduleEvent(
        makeEvent({ startUtc: '2026-01-15T20:00:00.000Z', endUtc: '2026-01-15T18:00:00.000Z' }),
      ).ok,
    ).toBe(false);

    expect(
      validateScheduleEvent(
        makeEvent({
          source: {
            type: 'playlist',
            playlistId: '',
            playlistVersionId: 'version-1',
          } as ScheduleEvent['source'],
        }),
      ).ok,
    ).toBe(false);
  });

  it('creates valid events only', () => {
    const event = createScheduleEvent({
      startUtc: '2026-01-15T18:00:00.000Z',
      endUtc: '2026-01-15T20:00:00.000Z',
      source: {
        type: 'playlist',
        playlistId: 'playlist-1',
        playlistVersionId: 'version-1',
      },
    });

    expect(event.eventId).toBeTruthy();
    expect(() =>
      createScheduleEvent({
        startUtc: '2026-01-15T20:00:00.000Z',
        endUtc: '2026-01-15T18:00:00.000Z',
        source: {
          type: 'playlist',
          playlistId: 'playlist-1',
          playlistVersionId: 'version-1',
        },
      }),
    ).toThrow(/earlier than end/i);
  });
});

describe('schedule conflict detection', () => {
  it('allows exact adjacency where end === next start', () => {
    const first = makeEvent({ eventId: 'a', endUtc: '2026-01-15T20:00:00.000Z' });
    const second = makeEvent({
      eventId: 'b',
      startUtc: '2026-01-15T20:00:00.000Z',
      endUtc: '2026-01-15T21:00:00.000Z',
    });

    expect(findScheduleConflicts(first, [second])).toEqual([]);
  });

  it('rejects real overlaps', () => {
    const first = makeEvent({ eventId: 'a', endUtc: '2026-01-15T20:00:00.000Z' });
    const second = makeEvent({
      eventId: 'b',
      startUtc: '2026-01-15T19:30:00.000Z',
      endUtc: '2026-01-15T21:00:00.000Z',
    });

    expect(findScheduleConflicts(first, [second])).toHaveLength(1);
  });

  it('ignores the edited event itself', () => {
    const first = makeEvent({ eventId: 'a' });
    expect(findScheduleConflicts(first, [first], { ignoreEventId: 'a' })).toEqual([]);
  });

  it('detects conflicts across the full canonical set', () => {
    const a = makeEvent({ eventId: 'a' });
    const b = makeEvent({
      eventId: 'b',
      startUtc: '2026-01-15T19:30:00.000Z',
      endUtc: '2026-01-15T21:00:00.000Z',
    });

    expect(validateScheduleSet([a, b]).conflicts).toHaveLength(1);
  });
});

describe('schedule editing', () => {
  it('preserves event identity and updates timestamps', () => {
    const original = makeEvent();
    const edited = editScheduleEvent(original, {
      title: 'New Title',
      endUtc: '2026-01-15T21:00:00.000Z',
    });

    expect(edited.eventId).toBe(original.eventId);
    expect(edited.title).toBe('New Title');
    expect(edited.updatedAt).not.toBe(original.updatedAt);
  });
});

describe('schedule recurrence validation', () => {
  it('accepts a daily recurrence', () => {
    expect(validateScheduleRecurrence(makeRecurrence())).toEqual({ ok: true });
  });

  it('requires weekdays for weekly recurrence', () => {
    const result = validateScheduleRecurrence(
      makeRecurrence({ frequency: 'weekly', daysOfWeek: [] }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects duplicate or out-of-range weekdays', () => {
    expect(
      validateScheduleRecurrence(makeRecurrence({ frequency: 'weekly', daysOfWeek: [1, 1] })).ok,
    ).toBe(false);
    expect(
      validateScheduleRecurrence(makeRecurrence({ frequency: 'weekly', daysOfWeek: [7] })).ok,
    ).toBe(false);
  });

  it('creates a recurrence with deterministic identity', () => {
    const recurrence = createScheduleRecurrence({
      ownerAddress: 'Q-owner',
      title: 'Daily',
      source: {
        type: 'playlist',
        playlistId: 'playlist-1',
        playlistVersionId: 'version-1',
      },
      timezone: 'Europe/Helsinki',
      frequency: 'daily',
      localStartTime: '20:00',
      durationMs: 1_800_000,
      activeFromLocalDate: '2026-01-01',
    });

    expect(recurrence.recurrenceId).toBeTruthy();
  });
});
