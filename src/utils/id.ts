/* ============================================================
 * NodeFM Station — ID Generation
 *
 * Stable, collision-resistant ID generation for domain entities.
 * Uses crypto.randomUUID() when available.
 * ============================================================ */

export function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  // Fallback for environments without crypto.randomUUID
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `${timestamp}-${random}`;
}
