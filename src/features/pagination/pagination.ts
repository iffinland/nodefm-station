/* ============================================================
 * NodeFM Station — Reusable Client-Side Pagination Model
 *
 * Pagination operates on an already-discovered collection only. The
 * canonical pipeline is:
 *
 * full data set -> search -> filters -> sort -> pagination
 *
 * This module contains no React, no QDN calls, and no page-side
 * mutations of the source collection.
 * ============================================================ */

export const LIST_PAGE_SIZES = [15, 30, 60, 100] as const;
export type ListPageSize = (typeof LIST_PAGE_SIZES)[number];

export const DEFAULT_LIST_PAGE_SIZE: ListPageSize = 15;
export const LIST_PAGE_SIZE_STORAGE_KEY = 'nodefm-list-page-size';

export function isListPageSize(value: unknown): value is ListPageSize {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    LIST_PAGE_SIZES.includes(value as ListPageSize)
  );
}

export function normalizeListPageSize(value: unknown): ListPageSize {
  if (typeof value === 'string') {
    const numeric = Number(value);
    return isListPageSize(numeric) ? numeric : DEFAULT_LIST_PAGE_SIZE;
  }

  return isListPageSize(value) ? value : DEFAULT_LIST_PAGE_SIZE;
}

export function getListPageSizeStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadListPageSize(storage: Storage | null = getListPageSizeStorage()): ListPageSize {
  if (!storage) {
    return DEFAULT_LIST_PAGE_SIZE;
  }

  try {
    return normalizeListPageSize(storage.getItem(LIST_PAGE_SIZE_STORAGE_KEY));
  } catch {
    return DEFAULT_LIST_PAGE_SIZE;
  }
}

export function saveListPageSize(
  pageSize: ListPageSize,
  storage: Storage | null = getListPageSizeStorage(),
): void {
  if (!storage) {
    return;
  }

  try {
    storage.setItem(LIST_PAGE_SIZE_STORAGE_KEY, String(pageSize));
  } catch {
    // Local preference persistence is best-effort and must never block UI.
  }
}

export function getTotalPages(totalItems: number, pageSize: number): number {
  if (!Number.isFinite(totalItems) || totalItems <= 0) {
    return 1;
  }

  const size = Math.max(1, Math.floor(pageSize));
  return Math.max(1, Math.ceil(totalItems / size));
}

export function clampPageIndex(pageIndex: number, totalPages: number): number {
  return Math.min(Math.max(0, pageIndex), Math.max(0, totalPages - 1));
}

export function paginateItems<T>(items: readonly T[], pageIndex: number, pageSize: number): T[] {
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const safePageIndex = Math.max(0, pageIndex);
  const start = safePageIndex * safePageSize;
  return items.slice(start, start + safePageSize);
}

export type PageRange = {
  start: number;
  end: number;
};

export function getPageRange(totalItems: number, pageIndex: number, pageSize: number): PageRange {
  if (!Number.isFinite(totalItems) || totalItems <= 0) {
    return { start: 0, end: 0 };
  }

  const safePageIndex = Math.max(0, pageIndex);
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const start = safePageIndex * safePageSize + 1;
  const end = Math.min(totalItems, start + safePageSize - 1);

  return { start, end };
}

export type PaginationPageItem = number | 'ellipsis-start' | 'ellipsis-end';

/**
 * Produce a compact page-number list. The first and last pages are
 * always present, and the current page has a one-page neighborhood.
 */
export function getPaginationPageItems(
  totalPages: number,
  currentPage: number,
): PaginationPageItem[] {
  const safeTotal = Math.max(1, totalPages);
  const safeCurrent = clampPageIndex(currentPage, safeTotal);

  if (safeTotal <= 7) {
    return Array.from({ length: safeTotal }, (_, index) => index);
  }

  const pages = new Set<number>([0, safeTotal - 1]);

  for (let page = safeCurrent - 1; page <= safeCurrent + 1; page += 1) {
    if (page >= 0 && page < safeTotal) {
      pages.add(page);
    }
  }

  const ordered = [...pages].sort((left, right) => left - right);
  const result: PaginationPageItem[] = [];

  for (let index = 0; index < ordered.length; index += 1) {
    const page = ordered[index];

    if (index > 0 && page - ordered[index - 1] > 1) {
      result.push('ellipsis-start');
    }

    result.push(page);
  }

  return result;
}
