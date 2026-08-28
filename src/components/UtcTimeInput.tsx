/* ============================================================
 * NodeFM Station — NodeFM-Controlled HH:mm Time Input
 *
 * A small locale-independent alternative to native <input type="time">.
 * Native time controls can render AM/PM based on the browser/OS locale,
 * which is not acceptable for NodeFM schedule times.
 * ============================================================ */

import { useId } from 'react';
import { formatClockInputWhileTyping, normalizeUtcTimeInput } from '../utils/utcTime';

export type UtcTimeInputProps = {
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
  suffix?: string;
};

export function UtcTimeInput({
  value,
  onChange,
  ariaLabel = 'Time (HH:mm)',
  disabled = false,
  className,
  suffix = 'UTC',
}: UtcTimeInputProps) {
  const hintId = useId();
  const inputId = useId();

  return (
    <div className={`utc-time-input${className ? ` ${className}` : ''}`}>
      <input
        id={inputId}
        type="text"
        inputMode="numeric"
        maxLength={5}
        value={value}
        aria-label={ariaLabel}
        aria-describedby={hintId}
        placeholder="HH:mm"
        disabled={disabled}
        onChange={(event) => onChange(formatClockInputWhileTyping(event.target.value))}
        onBlur={() => onChange(normalizeUtcTimeInput(value))}
      />
      <span id={hintId} className="utc-time-input__suffix" aria-hidden="true">
        {suffix}
      </span>
    </div>
  );
}
