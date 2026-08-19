/* ============================================================
 * NodeFM Station — Recurrence Compiler Tests
 *
 * Verifies Daily/Weekly admin intent compiles into deterministic
 * concrete UTC events, never evaluates recurrence at runtime, and
 * does not duplicate occurrences on recompilation.
 * ============================================================ */

import { describe, it, expect } from 'vitest';
import {
  compileScheduleRecurrence,
  getDeterministicOccurrenceEventId,
} from '../features/scheduling/services/recurrenceCompiler';
import {
  createScheduleRecurrence,
  type CreateScheduleRecurrenceInput,
} from '../features/scheduling/services/scheduleService';
import type { ScheduleRecurrence } from '../types/domain';

function recurrence(overrides: Partial<CreateScheduleRecurrenceInput> = {}): ScheduleRecurrence {
  return createScheduleRecurrence({
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
    ...overrides,
  });
}

const NOW = Date.parse('2026-01-15T12:00:00.000Z');

describe('daily recurrence compilation', () => {
  it('generates one concrete event per day in the bounded horizon', () => {
    const result = compileScheduleRecurrence(
      recurrence({ activeFromLocalDate: '2026-01-15', activeUntilLocalDate: '2026-01-18' }),
      NOW,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.events).toHaveLength(4);
    expect(result.generatedDates).toEqual(['2026-01-15', '2026-01-16', '2026-01-17', '2026-01-18']);
    expect(result.events[0]).toMatchObject({
      startUtc: '2026-01-15T18:00:00.000Z',
      endUtc: '2026-01-15T18:30:00.000Z',
      recurrenceId: result.events[0].recurrenceId,
      recurrenceInstanceKey: '2026-01-15',
    });
  });

  it('does not create duplicate event IDs on recompilation', () => {
    const recurrenceValue = recurrence({
      activeFromLocalDate: '2026-01-15',
      activeUntilLocalDate: '2026-01-20',
    });
    const first = compileScheduleRecurrence(recurrenceValue, NOW);
    const second = compileScheduleRecurrence(recurrenceValue, NOW);

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(first.events.map((event) => event.eventId)).toEqual(
      second.events.map((event) => event.eventId),
    );
    expect(new Set(first.events.map((event) => event.eventId)).size).toBe(first.events.length);
  });

  it('caps future generation at the configured 8-week horizon', () => {
    const result = compileScheduleRecurrence(
      recurrence({ activeFromLocalDate: '2020-01-01' }),
      NOW,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events.length).toBe(57);
  });
});

describe('weekly recurrence compilation', () => {
  it('generates only selected weekdays', () => {
    const result = compileScheduleRecurrence(
      recurrence({
        frequency: 'weekly',
        daysOfWeek: [1, 3],
        activeFromLocalDate: '2026-01-15',
        activeUntilLocalDate: '2026-01-25',
      }),
      NOW,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const dates = new Set(result.generatedDates);
    expect(dates.has('2026-01-19')).toBe(true);
    expect(dates.has('2026-01-21')).toBe(true);
    expect(dates.has('2026-01-20')).toBe(false);
  });
});

describe('DST-spanning recurrence', () => {
  it('keeps local start time stable across the spring transition', () => {
    const result = compileScheduleRecurrence(
      recurrence({
        activeFromLocalDate: '2026-03-28',
        activeUntilLocalDate: '2026-03-30',
      }),
      Date.parse('2026-03-28T12:00:00.000Z'),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.events.map((event) => event.startUtc)).toEqual([
      '2026-03-28T18:00:00.000Z',
      '2026-03-29T17:00:00.000Z',
      '2026-03-30T17:00:00.000Z',
    ]);
  });

  it('fails the whole batch for a nonexistent local wall time', () => {
    const result = compileScheduleRecurrence(
      recurrence({
        activeFromLocalDate: '2026-03-29',
        activeUntilLocalDate: '2026-03-29',
        localStartTime: '03:30',
      }),
      Date.parse('2026-03-29T12:00:00.000Z'),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toMatch(/does not exist/i);
  });
});

describe('deterministic occurrence identity', () => {
  it('derives a stable ID from recurrence and UTC start', () => {
    const idA = getDeterministicOccurrenceEventId(
      'recurrence-1',
      Date.parse('2026-01-15T18:00:00.000Z'),
    );
    const idB = getDeterministicOccurrenceEventId(
      'recurrence-1',
      Date.parse('2026-01-15T18:00:00.000Z'),
    );

    expect(idA).toBe(idB);
    expect(idA).toMatch(/^nodefm-generated-event-/);
  });
});
