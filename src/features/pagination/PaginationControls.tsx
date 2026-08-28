/* ============================================================
 * NodeFM Station — Reusable Pagination Controls
 *
 * Previous/Next, compact numbered pages, page-size selector, and
 * an honest "Showing X–Y of Z" summary. The component is presentational
 * and never performs data discovery.
 * ============================================================ */

import {
  getPageRange,
  getPaginationPageItems,
  getTotalPages,
  LIST_PAGE_SIZES,
  type ListPageSize,
} from './pagination';

export type PaginationControlsProps = {
  totalItems: number;
  pageIndex: number;
  pageSize: ListPageSize;
  onPageChange: (pageIndex: number) => void;
  onPageSizeChange: (pageSize: number) => void;
};

export function PaginationControls({
  totalItems,
  pageIndex,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: PaginationControlsProps) {
  const totalPages = getTotalPages(totalItems, pageSize);
  const range = getPageRange(totalItems, pageIndex, pageSize);
  const pageItems = getPaginationPageItems(totalPages, pageIndex);
  const previousDisabled = pageIndex <= 0;
  const nextDisabled = pageIndex >= totalPages - 1;

  return (
    <nav className="pagination" aria-label="Pagination">
      <p className="pagination__summary">
        Showing {range.start}–{range.end} of {totalItems}
      </p>

      <div className="pagination__controls">
        <button
          className="button button--secondary"
          type="button"
          onClick={() => onPageChange(pageIndex - 1)}
          disabled={previousDisabled}
        >
          Previous
        </button>

        {pageItems.map((item, itemIndex) =>
          item === 'ellipsis-start' ? (
            <span
              className="pagination__ellipsis"
              aria-hidden="true"
              key={`ellipsis-start-${itemIndex}`}
            >
              …
            </span>
          ) : typeof item === 'number' ? (
            <button
              className={`button ${item === pageIndex ? 'button--primary' : 'button--secondary'}`}
              type="button"
              key={item}
              onClick={() => onPageChange(item)}
              aria-label={`Page ${item + 1}`}
              aria-current={item === pageIndex ? 'page' : undefined}
            >
              {item + 1}
            </button>
          ) : null,
        )}

        <button
          className="button button--secondary"
          type="button"
          onClick={() => onPageChange(pageIndex + 1)}
          disabled={nextDisabled}
        >
          Next
        </button>
      </div>

      <label className="pagination__page-size">
        Rows per page
        <select value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
          {LIST_PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>
    </nav>
  );
}
