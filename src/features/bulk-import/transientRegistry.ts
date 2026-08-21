/* ============================================================
 * NodeFM Station — Bulk Import Transient Registry
 *
 * In-memory-only source/cover handles keyed by batch ID, row ID,
 * and source generation. Nothing in this registry is serialized.
 * ============================================================ */

import type { BulkImportTransientEntry } from './types';

export type BulkImportTransientRegistry = Map<string, BulkImportTransientEntry>;

export function createBulkImportTransientRegistry(): BulkImportTransientRegistry {
  return new Map();
}

export function transientSourceKey(
  batchId: string,
  rowId: string,
  sourceGeneration: number,
): string {
  return `${batchId}\u001f${rowId}\u001f${sourceGeneration}`;
}

export function getTransientEntry(
  registry: BulkImportTransientRegistry,
  key: string,
): BulkImportTransientEntry | undefined {
  return registry.get(key);
}

export function setTransientEntry(
  registry: BulkImportTransientRegistry,
  key: string,
  entry: BulkImportTransientEntry,
): void {
  registry.set(key, entry);
}

export function deleteTransientEntry(registry: BulkImportTransientRegistry, key: string): boolean {
  return registry.delete(key);
}

export function clearTransientRegistry(registry: BulkImportTransientRegistry): void {
  registry.clear();
}
