/* ============================================================
 * NodeFM Station — Shared Validation Helpers
 *
 * Small domain-neutral guards used by domain services so the
 * same invariants are enforced in one place.
 * ============================================================ */

export function isNonEmptyTrimmedString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
