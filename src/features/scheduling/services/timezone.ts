/* ============================================================
 * NodeFM Station — Timezone-Aware Scheduling Helpers
 *
 * Admin intent is expressed as local wall-clock date/time in an
 * IANA timezone. Canonical schedule events are stored in UTC.
 *
 * This module uses Intl.DateTimeFormat with the environment's ICU
 * timezone database rather than hard-coded fixed offsets.
 * ============================================================ */

export type ZonedWallTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export type LocalWallTimeInput = Omit<ZonedWallTime, 'second'> & {
  second?: number;
};

export type ZonedResolution =
  | { status: 'ok'; utcMs: number }
  | { status: 'ambiguous'; candidatesMs: number[] }
  | { status: 'nonexistent' };

const MINUTE_MS = 60_000;
const LOCAL_CANDIDATE_SEARCH_MS = 6 * 60 * 60_000;

export class InvalidTimeZoneError extends Error {
  constructor(timeZone: string) {
    super(`Invalid IANA timezone: ${timeZone}`);
    this.name = 'InvalidTimeZoneError';
  }
}

export class AmbiguousZonedTimeError extends Error {
  readonly candidatesMs: number[];

  constructor(candidatesMs: number[]) {
    super(
      `The requested local time is ambiguous because of daylight saving time (${candidatesMs.length} UTC interpretations).`,
    );
    this.name = 'AmbiguousZonedTimeError';
    this.candidatesMs = candidatesMs;
  }
}

export class NonexistentZonedTimeError extends Error {
  constructor() {
    super('The requested local time does not exist because of a daylight saving time transition.');
    this.name = 'NonexistentZonedTimeError';
  }
}

export function isValidIanaTimeZone(timeZone: string): boolean {
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

function timeZoneFormatter(timeZone: string): Intl.DateTimeFormat {
  if (!isValidIanaTimeZone(timeZone)) {
    throw new InvalidTimeZoneError(timeZone);
  }

  return new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone.trim(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
}

function dateOnlyFormatter(timeZone: string): Intl.DateTimeFormat {
  if (!isValidIanaTimeZone(timeZone)) {
    throw new InvalidTimeZoneError(timeZone);
  }

  return new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone.trim(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function partNumber(parts: Intl.DateTimeFormatPart[], type: string): number {
  const part = parts.find((candidate) => candidate.type === type);
  return part ? Number(part.value) : 0;
}

export function getZonedWallTime(utcMs: number, timeZone: string): ZonedWallTime {
  if (!Number.isFinite(utcMs) || !Number.isInteger(utcMs)) {
    throw new Error('utcMs must be a finite integer timestamp.');
  }

  const parts = timeZoneFormatter(timeZone).formatToParts(new Date(utcMs));

  return {
    year: partNumber(parts, 'year'),
    month: partNumber(parts, 'month'),
    day: partNumber(parts, 'day'),
    hour: partNumber(parts, 'hour'),
    minute: partNumber(parts, 'minute'),
    second: partNumber(parts, 'second'),
  };
}

export function getZonedDateParts(
  utcMs: number,
  timeZone: string,
): { year: number; month: number; day: number } {
  if (!Number.isFinite(utcMs) || !Number.isInteger(utcMs)) {
    throw new Error('utcMs must be a finite integer timestamp.');
  }

  const parts = dateOnlyFormatter(timeZone).formatToParts(new Date(utcMs));

  return {
    year: partNumber(parts, 'year'),
    month: partNumber(parts, 'month'),
    day: partNumber(parts, 'day'),
  };
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

export function formatZonedDateInput(utcMs: number, timeZone: string): string {
  const date = getZonedDateParts(utcMs, timeZone);
  return `${pad(date.year, 4)}-${pad(date.month, 2)}-${pad(date.day, 2)}`;
}

export function formatZonedDateTimeInput(utcMs: number, timeZone: string): string {
  const date = getZonedDateParts(utcMs, timeZone);
  const wall = getZonedWallTime(utcMs, timeZone);
  return `${pad(date.year, 4)}-${pad(date.month, 2)}-${pad(date.day, 2)}T${pad(wall.hour, 2)}:${pad(wall.minute, 2)}`;
}

export function formatZonedTimeInput(utcMs: number, timeZone: string): string {
  const wall = getZonedWallTime(utcMs, timeZone);
  return `${pad(wall.hour, 2)}:${pad(wall.minute, 2)}`;
}

function wallMatchesTarget(wall: ZonedWallTime, target: LocalWallTimeInput): boolean {
  return (
    wall.year === target.year &&
    wall.month === target.month &&
    wall.day === target.day &&
    wall.hour === target.hour &&
    wall.minute === target.minute &&
    wall.second === (target.second ?? 0)
  );
}

/**
 * Convert a station-local wall-clock time to one or more UTC instants.
 *
 * The implementation searches a bounded window around the naive UTC
 * timestamp and collects every instant whose Intl-rendered local time
 * exactly matches the requested wall time. This avoids fixed-offset
 * assumptions and explicitly exposes DST ambiguity/nonexistence.
 */
export function resolveZonedWallTimeToUtc(
  input: LocalWallTimeInput,
  timeZone: string,
): ZonedResolution {
  if (!isValidIanaTimeZone(timeZone)) {
    throw new InvalidTimeZoneError(timeZone);
  }

  if (
    !Number.isInteger(input.year) ||
    !Number.isInteger(input.month) ||
    input.month < 1 ||
    input.month > 12 ||
    !Number.isInteger(input.day) ||
    input.day < 1 ||
    input.day > 31 ||
    !Number.isInteger(input.hour) ||
    input.hour < 0 ||
    input.hour > 23 ||
    !Number.isInteger(input.minute) ||
    input.minute < 0 ||
    input.minute > 59 ||
    (input.second !== undefined &&
      (!Number.isInteger(input.second) || input.second < 0 || input.second > 59))
  ) {
    throw new Error('Invalid local wall-clock time.');
  }

  const target: LocalWallTimeInput = { ...input, second: input.second ?? 0 };
  const naiveUtcMs = Date.UTC(
    input.year,
    input.month - 1,
    input.day,
    input.hour,
    input.minute,
    input.second ?? 0,
  );

  const formatter = timeZoneFormatter(timeZone);
  const candidatesMs: number[] = [];

  let guessMs = naiveUtcMs;

  for (let iteration = 0; iteration < 12; iteration += 1) {
    const wall = getZonedWallTime(guessMs, timeZone);
    const targetMinutes =
      Date.UTC(
        target.year,
        target.month - 1,
        target.day,
        target.hour,
        target.minute,
        target.second,
      ) / MINUTE_MS;
    const currentMinutes =
      Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) /
      MINUTE_MS;
    const deltaMinutes = targetMinutes - currentMinutes;

    if (deltaMinutes === 0) {
      break;
    }

    guessMs += deltaMinutes * MINUTE_MS;
  }

  const windowStartMs = guessMs - LOCAL_CANDIDATE_SEARCH_MS;
  const windowEndMs = guessMs + LOCAL_CANDIDATE_SEARCH_MS;

  for (let candidateMs = windowStartMs; candidateMs <= windowEndMs; candidateMs += MINUTE_MS) {
    const parts = formatter.formatToParts(new Date(candidateMs));
    const wall: ZonedWallTime = {
      year: partNumber(parts, 'year'),
      month: partNumber(parts, 'month'),
      day: partNumber(parts, 'day'),
      hour: partNumber(parts, 'hour'),
      minute: partNumber(parts, 'minute'),
      second: partNumber(parts, 'second'),
    };

    if (wallMatchesTarget(wall, target)) {
      candidatesMs.push(candidateMs);
    }
  }

  if (candidatesMs.length === 0) {
    return { status: 'nonexistent' };
  }

  if (candidatesMs.length > 1) {
    return { status: 'ambiguous', candidatesMs };
  }

  return { status: 'ok', utcMs: candidatesMs[0] };
}

/**
 * Convert local wall time to a single UTC instant.
 *
 * Ambiguous and nonexistent local times are rejected rather than
 * silently choosing one DST interpretation. The scheduler UI must
 * present the resulting error to the owner.
 */
export function requireUnambiguousZonedUtcMs(input: LocalWallTimeInput, timeZone: string): number {
  const resolution = resolveZonedWallTimeToUtc(input, timeZone);

  if (resolution.status === 'nonexistent') {
    throw new NonexistentZonedTimeError();
  }

  if (resolution.status === 'ambiguous') {
    throw new AmbiguousZonedTimeError(resolution.candidatesMs);
  }

  return resolution.utcMs;
}

export function parseLocalDateInput(value: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    throw new Error('Local date must use YYYY-MM-DD format.');
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const test = new Date(Date.UTC(year, month - 1, day));

  if (
    test.getUTCFullYear() !== year ||
    test.getUTCMonth() + 1 !== month ||
    test.getUTCDate() !== day
  ) {
    throw new Error('Local date is not a valid calendar date.');
  }

  return { year, month, day };
}

export function parseLocalTimeInput(value: string): { hour: number; minute: number } {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    throw new Error('Local time must use HH:mm format.');
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error('Local time is out of range.');
  }

  return { hour, minute };
}

export function addDaysToLocalDate(dateString: string, deltaDays: number): string {
  const { year, month, day } = parseLocalDateInput(dateString);
  const shifted = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return `${pad(shifted.getUTCFullYear(), 4)}-${pad(shifted.getUTCMonth() + 1, 2)}-${pad(shifted.getUTCDate(), 2)}`;
}

export function compareLocalDates(left: string, right: string): number {
  const a = parseLocalDateInput(left);
  const b = parseLocalDateInput(right);
  const aValue = Date.UTC(a.year, a.month - 1, a.day);
  const bValue = Date.UTC(b.year, b.month - 1, b.day);
  return aValue - bValue;
}

export function isLocalDateBetween(
  dateString: string,
  fromInclusive: string,
  toInclusive: string,
): boolean {
  return (
    compareLocalDates(dateString, fromInclusive) >= 0 &&
    compareLocalDates(dateString, toInclusive) <= 0
  );
}

export function localDateForWeekday(dateString: string, daysOfWeek: readonly number[]): boolean {
  const { year, month, day } = parseLocalDateInput(dateString);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return daysOfWeek.includes(weekday);
}

/**
 * Resolve the first UTC instant for a station-local calendar date.
 *
 * This helper is intended for visual/week-boundary calculations only;
 * scheduling event creation still uses the strict ambiguous/nonexistent
 * rejection path. Midnight DST transitions are extremely rare, but when
 * they do occur this picks the first matching instant for display.
 */
export function getLocalDayStartUtcMs(dateString: string, timeZone: string): number {
  const { year, month, day } = parseLocalDateInput(dateString);
  const resolution = resolveZonedWallTimeToUtc({ year, month, day, hour: 0, minute: 0 }, timeZone);

  if (resolution.status === 'ok') {
    return resolution.utcMs;
  }

  if (resolution.status === 'ambiguous') {
    return resolution.candidatesMs[0];
  }

  return Date.UTC(year, month - 1, day);
}

export function getLocalDayBoundsUtcMs(
  dateString: string,
  timeZone: string,
): { startUtcMs: number; endUtcMs: number } {
  const startUtcMs = getLocalDayStartUtcMs(dateString, timeZone);
  const nextDate = addDaysToLocalDate(dateString, 1);
  const endUtcMs = getLocalDayStartUtcMs(nextDate, timeZone);
  return { startUtcMs, endUtcMs };
}
