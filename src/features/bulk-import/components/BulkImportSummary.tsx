/* ============================================================
 * NodeFM Station — Bulk Import Batch Summary
 * ============================================================ */

import { BULK_IMPORT_MAX_TOTAL_BYTES, BULK_IMPORT_MAX_TRACKS, formatMib } from '../limits';
import type { BulkImportBatchSummary } from '../selectors';

type BulkImportSummaryProps = {
  summary: BulkImportBatchSummary;
  capabilityMessage: string;
};

export function BulkImportSummary({ summary, capabilityMessage }: BulkImportSummaryProps) {
  const { limits } = summary;

  return (
    <section className="bulk-import__summary">
      <div className="bulk-import__meter" aria-live="polite">
        <div className="bulk-import__meter-item">
          <span className="bulk-import__meter-label">Tracks</span>
          <span className="bulk-import__meter-value">
            {limits.selectedCount} / {BULK_IMPORT_MAX_TRACKS}
          </span>
        </div>
        <div className="bulk-import__meter-item">
          <span className="bulk-import__meter-label">Size</span>
          <span className="bulk-import__meter-value">
            {formatMib(limits.selectedBytes)} MiB / {formatMib(BULK_IMPORT_MAX_TOTAL_BYTES)} MiB
          </span>
        </div>
        <div className="bulk-import__meter-item">
          <span className="bulk-import__meter-label">Remaining tracks</span>
          <span className="bulk-import__meter-value">{limits.remainingCount}</span>
        </div>
        <div className="bulk-import__meter-item">
          <span className="bulk-import__meter-label">Remaining size</span>
          <span className="bulk-import__meter-value">{formatMib(limits.remainingBytes)} MiB</span>
        </div>
      </div>

      <div className="bulk-import__counts">
        <span>{summary.validRows} valid</span>
        <span>{summary.rowsNeedingAttention} need attention</span>
      </div>

      {limits.exceedsTrackLimit ? (
        <p className="bulk-import__blocker">Selected tracks exceed the 15 track limit.</p>
      ) : null}

      {limits.exceedsSizeLimit ? (
        <p className="bulk-import__blocker">Selected audio exceeds the 100 MiB limit.</p>
      ) : null}

      <div className="bulk-import__capability">
        <span className="bulk-import__capability-badge">A2 pending</span>
        <span>{capabilityMessage}</span>
      </div>
    </section>
  );
}
