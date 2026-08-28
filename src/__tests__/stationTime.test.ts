/* ============================================================
 * NodeFM Station — Station-Local Time Presentation Tests
 *
 * The canonical timeline remains UTC. These tests verify the
 * shared presentation layer converts UTC to the configured
 * station timezone without relying on the browser/OS timezone.
 * ============================================================ */

import { describe, expect, it } from 'vitest';
import {
  formatScheduleDurationMinutes,
  formatScheduleTimeDisplay,
  formatStationDateInput,
  formatStationTimeContext,
  formatStationTimeInput,
  formatStationTimeRange,
} from '../utils/stationTime';

const HELSINKI = 'Europe/Helsinki';

describe('station-local time conversion', () => {
  it('uses Europe/Helsinki summer time (UTC+3)', () => {
    expect(formatStationTimeInput('2026-07-15T13:00:00.000Z', HELSINKI)).toBe('16:00');
  });

  it('uses Europe/Helsinki winter time (UTC+2)', () => {
    expect(formatStationTimeInput('2026-01-15T13:00:00.000Z', HELSINKI)).toBe('15:00');
  });

  it('always renders 24-hour HH:mm without AM/PM', () => {
    expect(formatStationTimeInput('2026-07-15T13:00:00.000Z', HELSINKI)).toMatch(/^\d{2}:\d{2}$/);
    expect(formatStationTimeInput('2026-07-15T13:00:00.000Z', HELSINKI)).not.toMatch(/AM|PM/i);
  });

  it('does not use the browser timezone as station truth', () => {
    const utc = '2026-07-15T13:00:00.000Z';
    expect(formatStationTimeInput(utc, HELSINKI)).toBe('16:00');
    expect(formatStationTimeInput(utc, 'America/New_York')).toBe('09:00');
  });
});

describe('station-local date derivation around UTC midnight', () => {
  it('rolls to the next station date when UTC is already late', () => {
    expect(formatStationDateInput('2026-08-28T22:00:00.000Z', HELSINKI)).toBe('2026-08-29');
  });

  it('keeps the same station date before local midnight', () => {
    expect(formatStationDateInput('2026-08-28T20:59:00.000Z', HELSINKI)).toBe('2026-08-28');
  });
});

describe('station-local time ranges', () => {
  it('formats a compact start–end range', () => {
    expect(
      formatStationTimeRange('2026-08-28T14:00:00.000Z', '2026-08-28T15:10:00.000Z', HELSINKI),
    ).toBe('17:00–18:10');
  });
});

describe('schedule duration', () => {
  it('reports a 70-minute event', () => {
    expect(
      formatScheduleDurationMinutes('2026-08-28T14:00:00.000Z', '2026-08-28T15:10:00.000Z'),
    ).toBe('70 min');
  });

  it('reports a 60-minute event', () => {
    expect(
      formatScheduleDurationMinutes('2026-08-28T14:00:00.000Z', '2026-08-28T15:00:00.000Z'),
    ).toBe('60 min');
  });

  it('reports a station-local midnight-crossing event as 120 minutes', () => {
    expect(
      formatScheduleDurationMinutes('2026-08-28T19:00:00.000Z', '2026-08-28T21:00:00.000Z'),
    ).toBe('120 min');
  });
});

describe('shared schedule display model', () => {
  it('shows station-local time first, UTC second, and duration', () => {
    expect(
      formatScheduleTimeDisplay('2026-08-28T14:00:00.000Z', '2026-08-28T15:10:00.000Z', HELSINKI),
    ).toEqual({
      stationDate: '2026-08-28',
      stationTimeRange: '17:00–18:10',
      utcTimeRange: '14:00–15:10 UTC',
      durationMinutes: '70 min',
    });
  });
});

describe('DST transitions', () => {
  it('converts the spring-forward boundary according to IANA rules', () => {
    expect(formatStationTimeInput('2026-03-29T00:59:00.000Z', HELSINKI)).toBe('02:59');
    expect(formatStationTimeInput('2026-03-29T01:00:00.000Z', HELSINKI)).toBe('04:00');
  });

  it('converts both autumn repeated-clock interpretations according to IANA rules', () => {
    expect(formatStationTimeInput('2026-10-25T00:30:00.000Z', HELSINKI)).toBe('03:30');
    expect(formatStationTimeInput('2026-10-25T01:30:00.000Z', HELSINKI)).toBe('03:30');
  });
});

describe('coming-up presentation', () => {
  it('derives the same station clock from the same UTC timeline instant', () => {
    const utcMs = Date.parse('2026-08-28T12:14:00.000Z');
    expect(formatStationTimeInput(utcMs, HELSINKI)).toBe('15:14');
    expect(formatStationTimeInput(utcMs, HELSINKI)).toBe('15:14');
  });

  it('is refresh-safe because formatting is deterministic', () => {
    const utcMs = Date.parse('2026-08-28T12:19:00.000Z');
    const first = formatStationTimeInput(utcMs, HELSINKI);
    const second = formatStationTimeInput(utcMs, HELSINKI);
    expect(second).toBe(first);
    expect(first).toBe('15:19');
  });

  it('produces a clear section-level timezone context', () => {
    expect(formatStationTimeContext(HELSINKI)).toBe('Station time · Europe/Helsinki');
  });
});
