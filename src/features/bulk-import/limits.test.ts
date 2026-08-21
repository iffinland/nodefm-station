import { describe, expect, it } from 'vitest';
import {
  addLocalStagingFiles,
  createBulkImportBatch,
  createBulkImportRow,
  removeBulkImportRow,
  setBulkImportRowSelected,
} from './batchStore';
import {
  BULK_IMPORT_MAX_TOTAL_BYTES,
  BULK_IMPORT_MAX_TRACKS,
  MIB_BYTES,
  getBulkImportLimits,
} from './limits';
import type { BulkImportBatch, BulkImportRow } from './types';

function makeRow(id: string, sizeBytes: number, selected = true): BulkImportRow {
  return createBulkImportRow({
    id,
    fileName: `Artist - Track ${id}.mp3`,
    mimeType: 'audio/mpeg',
    sizeBytes,
    selected,
  });
}

function makeBatch(rows: BulkImportRow[]): BulkImportBatch {
  return { ...createBulkImportBatch('admin', 'owner-scope'), rows };
}

describe('bulk import limits', () => {
  it('allows 14 and 15 selected tracks but blocks 16', () => {
    const rows14 = Array.from({ length: 14 }, (_, index) => makeRow(`r${index}`, 1));
    const rows15 = Array.from({ length: 15 }, (_, index) => makeRow(`r${index}`, 1));
    const rows16 = Array.from({ length: 16 }, (_, index) => makeRow(`r${index}`, 1));

    expect(getBulkImportLimits(rows14).exceedsTrackLimit).toBe(false);
    expect(getBulkImportLimits(rows15).exceedsTrackLimit).toBe(false);
    expect(getBulkImportLimits(rows15).selectedCount).toBe(BULK_IMPORT_MAX_TRACKS);
    expect(getBulkImportLimits(rows16).exceedsTrackLimit).toBe(true);
  });

  it('allows exactly 100 MiB and blocks anything above it', () => {
    expect(getBulkImportLimits([makeRow('ok', BULK_IMPORT_MAX_TOTAL_BYTES)]).exceedsSizeLimit).toBe(
      false,
    );
    expect(
      getBulkImportLimits([makeRow('over', BULK_IMPORT_MAX_TOTAL_BYTES + 1)]).exceedsSizeLimit,
    ).toBe(true);
  });

  it('recalculates both limits after removal', () => {
    const batch = makeBatch([
      makeRow('a', 60 * MIB_BYTES),
      makeRow('b', 40 * MIB_BYTES),
      makeRow('c', 1),
    ]);

    expect(getBulkImportLimits(batch.rows).selectedBytes).toBe(100 * MIB_BYTES + 1);

    const afterRemove = removeBulkImportRow(batch, 'c');
    const limits = getBulkImportLimits(afterRemove.rows);
    expect(limits.selectedBytes).toBe(100 * MIB_BYTES);
    expect(limits.selectedCount).toBe(2);
  });

  it('does not count excluded rows', () => {
    const rows = [
      makeRow('selected', 50 * MIB_BYTES, true),
      makeRow('excluded', 60 * MIB_BYTES, false),
    ];

    const limits = getBulkImportLimits(rows);
    expect(limits.selectedCount).toBe(1);
    expect(limits.selectedBytes).toBe(50 * MIB_BYTES);
    expect(limits.totalBytes).toBe(110 * MIB_BYTES);
  });

  it('can add real File entries and then exclude them without mutating limits', () => {
    const batch = createBulkImportBatch('listener', 'listener-scope');
    const fileA = new File([new Uint8Array([1, 2, 3])], 'A - One.mp3', { type: 'audio/mpeg' });
    const fileB = new File([new Uint8Array([4, 5])], 'B - Two.mp3', { type: 'audio/mpeg' });

    const added = addLocalStagingFiles(batch, [fileA, fileB]);
    const excluded = setBulkImportRowSelected(added.batch, added.added[0].rowId, false);

    expect(getBulkImportLimits(excluded.rows).selectedCount).toBe(1);
    expect(getBulkImportLimits(excluded.rows).selectedBytes).toBe(fileB.size);
  });
});
