/* ============================================================
 * NodeFM Station — Station-Local Time Presentation Helpers
 *
 * Canonical radio timeline values remain UTC. These helpers add
 * station-local context using the configured Station.timezone.
 *
 * They intentionally use Intl.DateTimeFormat with an explicit
 * IANA timezone and 24-hour `h23` hour cycle. They never use the
 * user's/browser timezone as station truth.
 * ============================================================ */

import { formatUtcTimeRange } from './utcTime';

const INVALID_TIME = '--:--';
const INVALID_DURATION = '-- min';

function toDate(value: string | number | Date): Date | null {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function isValidTimeZone(timeZone: string): boolean {
  if (typeof timeZone !== 'string' || timeZone.trim() === '') {
    return false;
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timeZone.trim() });
    return true;
  } catch {
    return false;
  }
}

function normalizeTimeZone(timeZone: string): string {
  return isValidTimeZone(timeZone) ? timeZone.trim() : 'UTC';
}

function stationTimeFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: normalizeTimeZone(timeZone),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

function stationDateFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: normalizeTimeZone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

/**
 * Format a UTC instant as station-local 24-hour HH:mm.
 */
export function formatStationTimeInput(value: string | number | Date, timeZone: string): string {
  const date = toDate(value);
  if (!date) {
    return INVALID_TIME;
  }

  return stationTimeFormatter(timeZone).format(date);
}

/**
 * Format a UTC instant as a station-local calendar date (YYYY-MM-DD).
 */
export function formatStationDateInput(value: string | number | Date, timeZone: string): string {
  const date = toDate(value);
  if (!date) {
    return '';
  }

  return stationDateFormatter(timeZone).format(date).replace(/\//g, '-');
}

/**
 * Format a UTC interval as station-local `HH:mm–HH:mm`.
 */
export function formatStationTimeRange(
  start: string | number | Date,
  end: string | number | Date,
  timeZone: string,
): string {
  const startTime = formatStationTimeInput(start, timeZone);
  const endTime = formatStationTimeInput(end, timeZone);

  if (startTime === INVALID_TIME || endTime === INVALID_TIME) {
    return `${INVALID_TIME}–${INVALID_TIME}`;
  }

  return `${startTime}–${endTime}`;
}

/**
 * Format total schedule duration in whole minutes. This uses the
 * concrete schedule start/end UTC interval and never playlist length.
 */
export function formatScheduleDurationMinutes(
  startUtc: string | number | Date,
  endUtc: string | number | Date,
): string {
  const start = toDate(startUtc);
  const end = toDate(endUtc);

  if (!start || !end) {
    return INVALID_DURATION;
  }

  const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60_000);
  if (!Number.isFinite(durationMinutes) || durationMinutes < 0) {
    return INVALID_DURATION;
  }

  return `${durationMinutes} min`;
}

export type StationScheduleTimeDisplay = {
  stationDate: string;
  stationTimeRange: string;
  utcTimeRange: string;
  durationMinutes: string;
};

/**
 * Build the shared presentation model used by listener Upcoming
 * Schedule and Admin Agenda rows.
 *
 * Station-local time is primary; UTC is retained as the canonical
 * reference in a compact secondary form.
 */
export function formatScheduleTimeDisplay(
  startUtc: string | number | Date,
  endUtc: string | number | Date,
  timeZone: string,
): StationScheduleTimeDisplay {
  return {
    stationDate: formatStationDateInput(startUtc, timeZone),
    stationTimeRange: formatStationTimeRange(startUtc, endUtc, timeZone),
    utcTimeRange: formatUtcTimeRange(startUtc, endUtc),
    durationMinutes: formatScheduleDurationMinutes(startUtc, endUtc),
  };
}

/**
 * Section-level station-time context label.
 */
export function formatStationTimeContext(timeZone: string): string {
  return `Station time · ${normalizeTimeZone(timeZone)}`;
}
