import { describe, expect, it } from 'vitest';
import {
  isValidReleaseDateValue,
  normalizeReleaseDateInput,
  RELEASE_DATE_HELP_TEXT,
} from './releaseDate';

describe('release date validation', () => {
  it('accepts YYYY', () => {
    expect(isValidReleaseDateValue('1991')).toBe(true);
  });

  it('accepts YYYY-MM', () => {
    expect(isValidReleaseDateValue('1991-08')).toBe(true);
  });

  it('accepts a valid YYYY-MM-DD', () => {
    expect(isValidReleaseDateValue('1991-08-12')).toBe(true);
    expect(isValidReleaseDateValue('2024-02-29')).toBe(true);
  });

  it('rejects invalid formats and impossible calendar dates', () => {
    expect(isValidReleaseDateValue('91')).toBe(false);
    expect(isValidReleaseDateValue('1991-8')).toBe(false);
    expect(isValidReleaseDateValue('1991-08-1')).toBe(false);
    expect(isValidReleaseDateValue('1991-13-01')).toBe(false);
    expect(isValidReleaseDateValue('2023-02-29')).toBe(false);
    expect(isValidReleaseDateValue('August 1991')).toBe(false);
    expect(isValidReleaseDateValue('')).toBe(false);
  });

  it('trims only surrounding whitespace for validation without normalizing the stored display', () => {
    expect(normalizeReleaseDateInput('  1991-08-12  ')).toBe('1991-08-12');
    expect(isValidReleaseDateValue('  1991-08-12  ')).toBe(true);
    expect(RELEASE_DATE_HELP_TEXT).toContain('YYYY-MM-DD');
  });
});
