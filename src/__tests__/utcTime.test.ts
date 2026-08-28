/* ============================================================
 * NodeFM Station — Canonical UTC Time Tests
 *
 * Verifies that station schedule times are locale-independent,
 * 24-hour HH:mm UTC values and that the controlled time input
 * helpers round-trip edge cases safely.
 * ============================================================ */

import { describe, expect, it } from 'vitest';
import {
  formatUtcDateInput,
  formatUtcDateTime,
  formatUtcTime,
  formatUtcTimeInput,
  formatUtcTimeRange,
  isValidUtcClockInput,
  normalizeUtcTimeInput,
} from '../utils/utcTime';

describe('formatUtcTime', () => {
  it('formats midnight, noon, afternoon, and late evening in 24-hour UTC', () => {
    expect(formatUtcTime('2026-08-28T00:00:00.000Z')).toBe('00:00 UTC');
    expect(formatUtcTime('2026-08-28T12:00:00.000Z')).toBe('12:00 UTC');
    expect(formatUtcTime('2026-08-28T14:30:00.000Z')).toBe('14:30 UTC');
    expect(formatUtcTime('2026-08-28T23:59:00.000Z')).toBe('23:59 UTC');
  });

  it('never uses AM/PM and does not depend on browser locale', () => {
    const formatted = formatUtcTime('2026-08-28T14:30:00.000Z');
    expect(formatted).toBe('14:30 UTC');
    expect(formatted).not.toMatch(/AM|PM/i);
    expect(formatted).toMatch(/^\d{2}:\d{2} UTC$/);
  });

  it('returns a stable invalid marker for malformed timestamps', () => {
    expect(formatUtcTime('not-a-date')).toBe('--:-- UTC');
    expect(formatUtcTimeInput('not-a-date')).toBe('--:--');
  });

  it('formats a compact UTC time range', () => {
    expect(formatUtcTimeRange('2026-08-28T14:00:00.000Z', '2026-08-28T15:10:00.000Z')).toBe(
      '14:00–15:10 UTC',
    );
  });
});

describe('formatUtcDateInput and formatUtcDateTime', () => {
  it('uses the UTC calendar date', () => {
    expect(formatUtcDateInput('2026-08-28T23:59:00.000Z')).toBe('2026-08-28');
    expect(formatUtcDateTime('2026-08-28T14:30:00.000Z')).toBe('2026-08-28 14:30 UTC');
  });
});

describe('controlled HH:mm input', () => {
  it('accepts valid zero-padded clock values', () => {
    expect(isValidUtcClockInput('00:00')).toBe(true);
    expect(isValidUtcClockInput('12:00')).toBe(true);
    expect(isValidUtcClockInput('23:59')).toBe(true);
  });

  it('rejects AM/PM and out-of-range values', () => {
    expect(isValidUtcClockInput('2:30 PM')).toBe(false);
    expect(isValidUtcClockInput('24:00')).toBe(false);
    expect(isValidUtcClockInput('23:60')).toBe(false);
    expect(isValidUtcClockInput('9:30')).toBe(false);
  });

  it('normalizes partial typing for editor round-trips', () => {
    expect(normalizeUtcTimeInput('0')).toBe('00:00');
    expect(normalizeUtcTimeInput('12')).toBe('12:00');
    expect(normalizeUtcTimeInput('23')).toBe('23:00');
    expect(normalizeUtcTimeInput('235')).toBe('23:50');
    expect(normalizeUtcTimeInput('2359')).toBe('23:59');
    expect(normalizeUtcTimeInput('')).toBe('');
  });
});
