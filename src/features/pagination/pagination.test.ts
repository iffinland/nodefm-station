/* ============================================================
 * NodeFM Station — Pagination Model Tests
 *
 * Focused coverage for the reusable client-side pagination
 * pipeline, preference normalization, and last-page clamping.
 * ============================================================ */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIST_PAGE_SIZE,
  LIST_PAGE_SIZES,
  LIST_PAGE_SIZE_STORAGE_KEY,
  clampPageIndex,
  getPageRange,
  getPaginationPageItems,
  getTotalPages,
  loadListPageSize,
  normalizeListPageSize,
  paginateItems,
  saveListPageSize,
} from './pagination';

function fakeStorage(initialValue?: string): Storage {
  const values = new Map<string, string>();
  if (initialValue !== undefined) {
    values.set(LIST_PAGE_SIZE_STORAGE_KEY, initialValue);
  }

  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  };
}

function makeItems(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index + 1);
}

describe('page-size normalization', () => {
  it('uses the default and accepts only configured sizes', () => {
    expect(normalizeListPageSize(undefined)).toBe(DEFAULT_LIST_PAGE_SIZE);
    expect(normalizeListPageSize(15)).toBe(15);
    expect(normalizeListPageSize('30')).toBe(30);
    expect(normalizeListPageSize(60)).toBe(60);
    expect(normalizeListPageSize(100)).toBe(100);
    expect(normalizeListPageSize(999)).toBe(DEFAULT_LIST_PAGE_SIZE);
    expect(normalizeListPageSize('not-a-number')).toBe(DEFAULT_LIST_PAGE_SIZE);
  });

  it('persists and reloads a valid local preference', () => {
    const storage = fakeStorage();
    saveListPageSize(60, storage);
    expect(loadListPageSize(storage)).toBe(60);
  });

  it('falls back to 15 for malformed local preference values', () => {
    expect(loadListPageSize(fakeStorage('999'))).toBe(15);
    expect(loadListPageSize(fakeStorage('banana'))).toBe(15);
  });

  it('returns the default when storage is unavailable', () => {
    expect(loadListPageSize(null)).toBe(15);
    expect(saveListPageSize(30, null)).toBeUndefined();
  });
});

describe('pagination pipeline', () => {
  it('paginates 37 items into 15 / 15 / 7', () => {
    const items = makeItems(37);

    expect(getTotalPages(items.length, 15)).toBe(3);
    expect(paginateItems(items, 0, 15)).toHaveLength(15);
    expect(paginateItems(items, 1, 15)).toHaveLength(15);
    expect(paginateItems(items, 2, 15)).toHaveLength(7);
    expect(paginateItems(items, 2, 15)[0]).toBe(31);
  });

  it('supports every configured page size', () => {
    const items = makeItems(137);

    for (const pageSize of LIST_PAGE_SIZES) {
      const totalPages = getTotalPages(items.length, pageSize);
      const lastPage = totalPages - 1;
      const page = paginateItems(items, lastPage, pageSize);
      expect(page.length).toBeGreaterThan(0);
      expect(page.length).toBeLessThanOrEqual(pageSize);
    }
  });

  it('clamps invalid page indices to a valid page', () => {
    const items = makeItems(15);
    expect(clampPageIndex(-1, getTotalPages(items.length, 15))).toBe(0);
    expect(clampPageIndex(99, getTotalPages(items.length, 15))).toBe(0);
  });

  it('clamps removal of the last item on the last page', () => {
    expect(clampPageIndex(2, getTotalPages(15, 15))).toBe(0);
    expect(paginateItems(makeItems(15), 0, 15)).toHaveLength(15);
  });

  it('reports an honest empty range for zero items', () => {
    expect(getPageRange(0, 0, 15)).toEqual({ start: 0, end: 0 });
    expect(getTotalPages(0, 15)).toBe(1);
  });

  it('builds compact page-number items around the current page', () => {
    expect(getPaginationPageItems(10, 4)).toContain(4);
    expect(getPaginationPageItems(10, 0)[0]).toBe(0);
    const lastPageItems = getPaginationPageItems(10, 9);
    expect(lastPageItems[lastPageItems.length - 1]).toBe(9);
  });
});
