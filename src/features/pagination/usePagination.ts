/* ============================================================
 * NodeFM Station — usePagination Hook
 *
 * Owns page index and page-size state for one list surface. The
 * caller owns search/filter/sort and is responsible for calling
 * `reset` when those inputs change. Deletion/moderation shrink is
 * handled here by clamping to the last valid page.
 * ============================================================ */

import { useCallback, useEffect, useState } from 'react';
import {
  clampPageIndex,
  getTotalPages,
  loadListPageSize,
  normalizeListPageSize,
  saveListPageSize,
  type ListPageSize,
} from './pagination';

export type UsePaginationResult = {
  pageIndex: number;
  pageSize: ListPageSize;
  totalPages: number;
  setPageIndex: (pageIndex: number) => void;
  setPageSize: (pageSize: number) => void;
  reset: () => void;
};

export function usePagination(totalItems: number): UsePaginationResult {
  const [pageSize, setPageSizeState] = useState<ListPageSize>(() => loadListPageSize());
  const [pageIndex, setPageIndexState] = useState(0);
  const totalPages = getTotalPages(totalItems, pageSize);
  const safePageIndex = clampPageIndex(pageIndex, totalPages);

  useEffect(() => {
    setPageIndexState((current) => clampPageIndex(current, totalPages));
  }, [totalPages]);

  const setPageIndex = useCallback(
    (nextPageIndex: number) => {
      setPageIndexState(clampPageIndex(nextPageIndex, totalPages));
    },
    [totalPages],
  );

  const setPageSize = useCallback((nextPageSize: number) => {
    const normalized = normalizeListPageSize(nextPageSize);
    setPageSizeState(normalized);
    saveListPageSize(normalized);
    setPageIndexState(0);
  }, []);

  const reset = useCallback(() => {
    setPageIndexState(0);
  }, []);

  return {
    pageIndex: safePageIndex,
    pageSize,
    totalPages,
    setPageIndex,
    setPageSize,
    reset,
  };
}
