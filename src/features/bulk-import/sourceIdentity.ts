/* ============================================================
 * NodeFM Station — Bulk Import Source Identity
 *
 * Descriptor comparison used to distinguish an intentional source
 * replacement from a post-reload re-binding that selected a clearly
 * different file. Comparison uses safe local descriptors only.
 * ============================================================ */

import type { BulkImportLocalSourceDescriptor } from './types';

/**
 * Filename and byte size are always compared. MIME type is compared
 * only when both sides provide a value, because browser File.type can
 * legitimately be empty for unknown formats.
 */
export function sourceDescriptorsMatch(
  current: BulkImportLocalSourceDescriptor | null,
  candidate: BulkImportLocalSourceDescriptor,
): boolean {
  if (!current) return false;
  if (current.fileName !== candidate.fileName || current.sizeBytes !== candidate.sizeBytes) {
    return false;
  }

  if (current.mimeType && candidate.mimeType && current.mimeType !== candidate.mimeType) {
    return false;
  }

  return true;
}
