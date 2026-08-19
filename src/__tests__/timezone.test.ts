/* ============================================================
 * NodeFM Station — Timezone Conversion Tests
 *
 * Exercises the production Intl-based local-wall-clock to UTC
 * resolver across normal, DST-transition, ambiguous, and
 * nonexistent Europe/Helsinki times.
 * ============================================================ */

import { describe, it, expect } from 'vitest';
import {
  formatZonedDateTimeInput,
  isValidIanaTimeZone,
  requireUnambiguousZonedUtcMs,
  resolveZonedWallTimeToUtc,
} from '../features/scheduling/services/timezone';

const TZ = 'Europe/Helsinki';

describe('IANA timezone validation', () => {
  it('accepts a valid timezone and rejects invalid values', () => {
    expect(isValidIanaTimeZone(TZ)).toBe(true);
    expect(isValidIanaTimeZone('UTC')).toBe(true);
    expect(isValidIanaTimeZone('Not/AZone')).toBe(false);
    expect(isValidIanaTimeZone('')).toBe(false);
  });
});

describe('normal local wall-clock to UTC conversion', () => {
  it('uses the winter offset', () => {
    expect(
      requireUnambiguousZonedUtcMs({ year: 2026, month: 1, day: 15, hour: 12, minute: 0 }, TZ),
    ).toBe(Date.parse('2026-01-15T10:00:00.000Z'));
  });

  it('uses the summer offset', () => {
    expect(
      requireUnambiguousZonedUtcMs({ year: 2026, month: 7, day: 15, hour: 12, minute: 0 }, TZ),
    ).toBe(Date.parse('2026-07-15T09:00:00.000Z'));
  });

  it('round-trips UTC through the same local wall-clock fields', () => {
    const utcMs = Date.parse('2026-07-15T09:00:00.000Z');
    expect(formatZonedDateTimeInput(utcMs, TZ)).toBe('2026-07-15T12:00');
  });
});

describe('DST spring transition', () => {
  it('converts the last valid time before the jump', () => {
    expect(
      requireUnambiguousZonedUtcMs({ year: 2026, month: 3, day: 29, hour: 2, minute: 59 }, TZ),
    ).toBe(Date.parse('2026-03-29T00:59:00.000Z'));
  });

  it('reports a nonexistent spring wall time instead of guessing', () => {
    expect(
      resolveZonedWallTimeToUtc({ year: 2026, month: 3, day: 29, hour: 3, minute: 30 }, TZ),
    ).toEqual({ status: 'nonexistent' });

    expect(() =>
      requireUnambiguousZonedUtcMs({ year: 2026, month: 3, day: 29, hour: 3, minute: 30 }, TZ),
    ).toThrow(/does not exist/i);
  });

  it('converts the post-jump time correctly', () => {
    expect(
      requireUnambiguousZonedUtcMs({ year: 2026, month: 3, day: 29, hour: 4, minute: 0 }, TZ),
    ).toBe(Date.parse('2026-03-29T01:00:00.000Z'));
  });
});

describe('DST autumn transition', () => {
  it('exposes both UTC interpretations for the repeated local hour', () => {
    const resolution = resolveZonedWallTimeToUtc(
      { year: 2026, month: 10, day: 25, hour: 3, minute: 30 },
      TZ,
    );

    expect(resolution.status).toBe('ambiguous');
    if (resolution.status !== 'ambiguous') return;

    expect(resolution.candidatesMs).toEqual([
      Date.parse('2026-10-25T00:30:00.000Z'),
      Date.parse('2026-10-25T01:30:00.000Z'),
    ]);
  });

  it('rejects ambiguous autumn times rather than silently choosing one', () => {
    expect(() =>
      requireUnambiguousZonedUtcMs({ year: 2026, month: 10, day: 25, hour: 3, minute: 30 }, TZ),
    ).toThrow(/ambiguous/i);
  });
});
