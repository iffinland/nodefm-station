/* ============================================================
 * NodeFM Station — Canonical UTC Time Helpers
 *
 * All user-facing station schedule times share this module so
 * they render as locale-independent, 24-hour HH:mm UTC values.
 * Storage timestamps are never mutated here.
 * ============================================================ */

const INVALID_TIME = '--:--';

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

function toUtcDate(value: string | number | Date): Date | null {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

/**
 * Format a UTC timestamp as HH:mm, without any timezone conversion or
 * locale-dependent AM/PM formatting.
 */
export function formatUtcTimeInput(value: string | number | Date): string {
  const date = toUtcDate(value);
  if (!date) {
    return INVALID_TIME;
  }

  return `${pad(date.getUTCHours(), 2)}:${pad(date.getUTCMinutes(), 2)}`;
}

/**
 * Format a UTC timestamp using the canonical NodeFM display form:
 * `14:30 UTC`.
 */
export function formatUtcTime(value: string | number | Date): string {
  const time = formatUtcTimeInput(value);
  return time === INVALID_TIME ? `${INVALID_TIME} UTC` : `${time} UTC`;
}

/**
 * Format a UTC start/end pair using the canonical NodeFM range form:
 * `14:00–15:10 UTC`.
 */
export function formatUtcTimeRange(
  start: string | number | Date,
  end: string | number | Date,
): string {
  const startTime = formatUtcTimeInput(start);
  const endTime = formatUtcTimeInput(end);

  if (startTime === INVALID_TIME || endTime === INVALID_TIME) {
    return `${INVALID_TIME}–${INVALID_TIME} UTC`;
  }

  return `${startTime}–${endTime} UTC`;
}

/**
 * Format the UTC calendar date as YYYY-MM-DD.
 */
export function formatUtcDateInput(value: string | number | Date): string {
  const date = toUtcDate(value);
  if (!date) {
    return '';
  }

  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)}`;
}

/**
 * Convenience label for date-plus-time surfaces such as Request Show
 * generated occurrences. The time portion remains the canonical form.
 */
export function formatUtcDateTime(value: string | number | Date): string {
  const date = formatUtcDateInput(value);
  const time = formatUtcTime(value);
  return date ? `${date} ${time}` : time;
}

/**
 * Validate an HH:mm UTC clock input. The value must be zero-padded and
 * within 00:00..23:59.
 */
export function isValidUtcClockInput(value: string): boolean {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    return false;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

function digitsFromClockInput(value: string): string {
  return value.replace(/\D/g, '').slice(0, 4);
}

/**
 * Format typed digits as a partial/complete HH:mm input. This helper is
 * intentionally permissive during typing and is paired with
 * `normalizeUtcTimeInput` on blur.
 */
export function formatClockInputWhileTyping(value: string): string {
  const digits = digitsFromClockInput(value);

  if (digits.length <= 2) {
    return digits;
  }

  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

/**
 * Convert a partial clock input into a complete, zero-padded HH:mm value
 * for editor round-tripping.
 */
export function normalizeUtcTimeInput(value: string): string {
  const digits = digitsFromClockInput(value);

  if (!digits) {
    return '';
  }

  if (digits.length === 1) {
    return `0${digits}:00`;
  }

  if (digits.length === 2) {
    return `${digits}:00`;
  }

  if (digits.length === 3) {
    return `${digits.slice(0, 2)}:${digits.slice(2)}0`;
  }

  return formatClockInputWhileTyping(digits);
}
