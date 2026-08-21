/* ============================================================
 * NodeFM Station — QDN Read Error Classification
 *
 * QDN reads can fail for materially different reasons:
 *   - confirmed absence (a tombstone / not-published resource);
 *   - transient or transport unavailability;
 *   - a returned payload that is malformed.
 *
 * Store/reconstruction code must not collapse those cases. This
 * module keeps that classification in one place so consumers can
 * use structured evidence instead of broad error-string matching.
 * ============================================================ */

export type QdnResourceReadErrorCode = 'NOT_FOUND' | 'UNAVAILABLE' | 'MALFORMED';

/**
 * Current Core contract for a confirmed absent QDN resource. Home exposes
 * this as error code 1401 paired with HTTP 404. NodeFM sees the Home bridge
 * rejection text, so classification recognizes both the structured code and
 * the stable Core absence phrase.
 */
export const QDN_FILE_NOT_FOUND_ERROR = 1401;

export class QdnResourceReadError extends Error {
  readonly code: QdnResourceReadErrorCode;
  readonly cause: unknown;

  constructor(code: QdnResourceReadErrorCode, detail: string, cause?: unknown) {
    super(detail);
    this.name = 'QdnResourceReadError';
    this.code = code;
    this.cause = cause;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function numericErrorCode(value: unknown): number | null {
  if (isRecord(value)) {
    const error = value.error;

    if (typeof error === 'number' && Number.isInteger(error)) {
      return error;
    }

    if (typeof error === 'string' && /^\d+$/.test(error.trim())) {
      return Number(error.trim());
    }
  }

  return null;
}

/**
 * Extract a QDN/Core numeric error code from a bridge rejection or from a
 * stringified node error body. This keeps the known 1401 semantic explicit
 * without scattering raw-number checks through stores.
 */
export function getQdnNodeErrorCode(error: unknown): number | null {
  const direct = numericErrorCode(error);
  if (direct !== null) {
    return direct;
  }

  if (!(error instanceof Error)) {
    return null;
  }

  const fromMessageText = /(?:^|\b)(?:QDN\s+)?error\s+(\d+)\b/i.exec(error.message);
  if (fromMessageText) {
    return Number(fromMessageText[1]);
  }

  const fromMessage = numericErrorCode(error.message);
  if (fromMessage !== null) {
    return fromMessage;
  }

  try {
    return numericErrorCode(JSON.parse(error.message) as unknown);
  } catch {
    return null;
  }
}

export function getQdnResourceReadErrorCode(error: unknown): QdnResourceReadErrorCode | null {
  if (error instanceof QdnResourceReadError) {
    return error.code;
  }

  if (
    isRecord(error) &&
    typeof error.code === 'string' &&
    (error.code === 'NOT_FOUND' || error.code === 'UNAVAILABLE' || error.code === 'MALFORMED')
  ) {
    return error.code;
  }

  return null;
}

/**
 * Narrow confirmed-not-found classification. This intentionally excludes
 * `unavailable`, timeouts, and other transient read failures.
 */
export function isConfirmedQdnNotFoundError(error: unknown): boolean {
  const code = getQdnResourceReadErrorCode(error);
  if (code) {
    return code === 'NOT_FOUND';
  }

  if (getQdnNodeErrorCode(error) === QDN_FILE_NOT_FOUND_ERROR) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  return (
    /\b(does not exist|not found|not published)\b/i.test(error.message) ||
    /\bcouldn't find put transaction\b/i.test(error.message) ||
    /\bno file exists\b/i.test(error.message) ||
    /\bHTTP (404|410)\b/i.test(error.message)
  );
}
