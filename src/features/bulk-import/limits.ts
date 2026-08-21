/* ============================================================
 * NodeFM Station — Bulk Import Product Limits
 *
 * NodeFM product limits for a single staging batch. These are
 * independent of Qortium Core/Home resource limits.
 *
 * Binary MiB is used consistently:
 *   1 MiB = 1024 * 1024 bytes
 * ============================================================ */

import type { BulkImportRow } from './types';

export const BULK_IMPORT_MAX_TRACKS = 15;
export const MIB_BYTES = 1024 * 1024;
export const BULK_IMPORT_MAX_TOTAL_BYTES = 100 * MIB_BYTES;

export type BulkImportLimits = {
  selectedCount: number;
  totalCount: number;
  selectedBytes: number;
  totalBytes: number;
  remainingCount: number;
  remainingBytes: number;
  exceedsTrackLimit: boolean;
  exceedsSizeLimit: boolean;
};

export function getSelectedBulkImportRows(rows: readonly BulkImportRow[]): BulkImportRow[] {
  return rows.filter((row) => row.selected);
}

export function getBulkImportLimits(rows: readonly BulkImportRow[]): BulkImportLimits {
  const selectedRows = getSelectedBulkImportRows(rows);
  const selectedCount = selectedRows.length;
  const selectedBytes = selectedRows.reduce(
    (sum, row) => sum + (row.localSource?.sizeBytes ?? 0),
    0,
  );
  const totalCount = rows.length;
  const totalBytes = rows.reduce((sum, row) => sum + (row.localSource?.sizeBytes ?? 0), 0);

  return {
    selectedCount,
    totalCount,
    selectedBytes,
    totalBytes,
    remainingCount: Math.max(BULK_IMPORT_MAX_TRACKS - selectedCount, 0),
    remainingBytes: Math.max(BULK_IMPORT_MAX_TOTAL_BYTES - selectedBytes, 0),
    exceedsTrackLimit: selectedCount > BULK_IMPORT_MAX_TRACKS,
    exceedsSizeLimit: selectedBytes > BULK_IMPORT_MAX_TOTAL_BYTES,
  };
}

export function formatMib(bytes: number): string {
  return (bytes / MIB_BYTES).toFixed(1);
}
