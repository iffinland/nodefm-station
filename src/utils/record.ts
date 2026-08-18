/* ============================================================
 * NodeFM Station — Record Guard
 *
 * Small shared type guard for plain JSON object values.
 * ============================================================ */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
