/* ============================================================
 * NodeFM Station — Duration Tests
 *
 * Pure domain logic tests for duration validation.
 * ============================================================ */

import { describe, it, expect } from 'vitest';
import {
  isValidDurationMs,
  isScheduleEligibleDuration,
  calculateTotalDurationMs,
  formatDurationMs,
} from '../utils/duration';

describe('isValidDurationMs', () => {
  it('accepts positive integer', () => {
    expect(isValidDurationMs(1000)).toBe(true);
    expect(isValidDurationMs(1)).toBe(true);
    expect(isValidDurationMs(2147483647)).toBe(true);
  });

  it('rejects zero', () => {
    expect(isValidDurationMs(0)).toBe(false);
  });

  it('rejects negative', () => {
    expect(isValidDurationMs(-1000)).toBe(false);
  });

  it('rejects NaN', () => {
    expect(isValidDurationMs(NaN)).toBe(false);
  });

  it('rejects Infinity', () => {
    expect(isValidDurationMs(Infinity)).toBe(false);
    expect(isValidDurationMs(-Infinity)).toBe(false);
  });

  it('rejects non-number', () => {
    expect(isValidDurationMs('1000')).toBe(false);
    expect(isValidDurationMs(null)).toBe(false);
    expect(isValidDurationMs(undefined)).toBe(false);
  });

  it('rejects non-integer', () => {
    expect(isValidDurationMs(1000.5)).toBe(false);
  });
});

describe('isScheduleEligibleDuration', () => {
  it('matches isValidDurationMs', () => {
    expect(isScheduleEligibleDuration(5000)).toBe(true);
    expect(isScheduleEligibleDuration(0)).toBe(false);
    expect(isScheduleEligibleDuration(NaN)).toBe(false);
  });
});

describe('calculateTotalDurationMs', () => {
  it('sums valid durations', () => {
    expect(calculateTotalDurationMs([1000, 2000, 3000])).toBe(6000);
  });

  it('skips invalid durations', () => {
    expect(calculateTotalDurationMs([1000, 0, NaN, -1, 3000])).toBe(4000);
  });

  it('returns 0 for empty array', () => {
    expect(calculateTotalDurationMs([])).toBe(0);
  });
});

describe('formatDurationMs', () => {
  it('formats seconds only', () => {
    expect(formatDurationMs(45000)).toBe('0:45');
  });

  it('formats minutes and seconds', () => {
    expect(formatDurationMs(125000)).toBe('2:05');
  });

  it('formats hours', () => {
    expect(formatDurationMs(3661000)).toBe('1:01:01');
  });

  it('returns dash for invalid', () => {
    expect(formatDurationMs(0)).toBe('—');
    expect(formatDurationMs(NaN)).toBe('—');
  });
});
