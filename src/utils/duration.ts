/* ============================================================
 * NodeFM Station — Duration Utilities
 *
 * Duration validation, resolution, and formatting.
 * A track without valid duration is not schedule-eligible.
 * ============================================================ */

// ── Duration Validation ─────────────────────────────────────────────

/** A valid duration is a finite, positive integer in milliseconds. */
export function isValidDurationMs(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    !Number.isNaN(value) &&
    Number.isInteger(value) &&
    value > 0
  );
}

/** Duration eligibility check for schedule inclusion. */
export function isScheduleEligibleDuration(value: unknown): boolean {
  return isValidDurationMs(value);
}

// ── Duration Resolution ─────────────────────────────────────────────

/**
 * Resolve the duration of an audio file from its ArrayBuffer.
 * Uses Web Audio API to decode and measure.
 * Returns duration in milliseconds.
 */
export async function resolveAudioDurationMs(buffer: ArrayBuffer): Promise<number> {
  const audioContext = new AudioContext();

  try {
    const audioBuffer = await audioContext.decodeAudioData(buffer);
    return Math.round(audioBuffer.duration * 1000);
  } finally {
    await audioContext.close();
  }
}

/**
 * Resolve duration from an audio URL by fetching and decoding.
 */
export async function resolveAudioDurationFromUrl(url: string): Promise<number> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch audio: ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  return resolveAudioDurationMs(buffer);
}

// ── Duration Formatting ─────────────────────────────────────────────

export function formatDurationMs(ms: number): string {
  if (!isValidDurationMs(ms)) {
    return '—';
  }

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function formatDurationSeconds(seconds: number): string {
  return formatDurationMs(Math.round(seconds * 1000));
}

// ── Total Duration Calculation ──────────────────────────────────────

export function calculateTotalDurationMs(durations: number[]): number {
  return durations.reduce((sum, d) => {
    if (!isValidDurationMs(d)) return sum;
    return sum + d;
  }, 0);
}
