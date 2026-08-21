/* ============================================================
 * NodeFM Station — Release Date Validation
 *
 * Optional Track release date is deliberately stored as the
 * owner/listener-entered display string. The accepted forms are:
 *
 *   YYYY
 *   YYYY-MM
 *   YYYY-MM-DD
 *
 * Validation is intentionally calendar-aware for full dates so
 * values such as 2024-02-30 or 2023-13 are rejected, while partial
 * year/month forms remain allowed. No date is rewritten into a
 * normalized ISO representation.
 * ============================================================ */

export const RELEASE_DATE_HELP_TEXT = 'Use YYYY, YYYY-MM, or YYYY-MM-DD.';

const RELEASE_DATE_PATTERN = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }

  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function normalizeReleaseDateInput(value: string): string {
  return value.trim();
}

/**
 * Return true only for a non-empty string in one of the accepted
 * human-readable formats. The value is not normalized or rewritten.
 */
export function isValidReleaseDateValue(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }

  const trimmed = normalizeReleaseDateInput(value);
  if (!trimmed) {
    return false;
  }

  const match = RELEASE_DATE_PATTERN.exec(trimmed);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = match[2] ? Number(match[2]) : undefined;
  const day = match[3] ? Number(match[3]) : undefined;

  // The YYYY form accepts years in the fixed four-digit range.
  if (year < 1000 || year > 9999) {
    return false;
  }

  if (month === undefined) {
    return true;
  }

  if (month < 1 || month > 12) {
    return false;
  }

  if (day === undefined) {
    return true;
  }

  return day >= 1 && day <= daysInMonth(year, month);
}
