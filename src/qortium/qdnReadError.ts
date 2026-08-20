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

  if (!(error instanceof Error)) {
    return false;
  }

  return (
    /\b(does not exist|not found|not published)\b/i.test(error.message) ||
    /\bHTTP (404|410)\b/i.test(error.message)
  );
}
