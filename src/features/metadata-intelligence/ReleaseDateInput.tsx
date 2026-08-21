/* ============================================================
 * NodeFM Station — Release Date Input
 *
 * A plain text input for the optional Track release date.
 * Accepted values are YYYY, YYYY-MM, and YYYY-MM-DD. The field
 * intentionally does not force a calendar-picker-only UX.
 * ============================================================ */

import { isValidReleaseDateValue, RELEASE_DATE_HELP_TEXT } from './releaseDate';

type ReleaseDateInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
};

export function ReleaseDateInput({ value, onChange, placeholder }: ReleaseDateInputProps) {
  const trimmed = value.trim();
  const invalid = trimmed.length > 0 && !isValidReleaseDateValue(trimmed);

  return (
    <div className="release-date-field">
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        aria-label="Release date"
        aria-invalid={invalid || undefined}
      />
      <span className="release-date-field__help">{RELEASE_DATE_HELP_TEXT}</span>
      {invalid ? (
        <span className="release-date-field__error">
          Enter a release date as YYYY, YYYY-MM, or YYYY-MM-DD.
        </span>
      ) : null}
    </div>
  );
}
