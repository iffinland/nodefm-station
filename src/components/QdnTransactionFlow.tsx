/* ============================================================
 * NodeFM Station — QDN Transaction Flow
 *
 * Shared chunk-based presentation for coordinated QDN writes. It is
 * deliberately presentation-only: feature code owns the operation
 * and advances `QdnTransactionState`.
 * ============================================================ */

import { Modal } from './Modal';
import type { QdnTransactionState } from './qdnTransactionFlow';

type QdnTransactionFlowProps = {
  title: string;
  state: QdnTransactionState;
  onClose: () => void;
  onRetry?: () => void;
  onCancel?: () => void;
  successMessage?: string;
  standalone?: boolean;
};

function statusIcon(status: QdnTransactionState['chunks'][number]['status']) {
  if (status === 'succeeded') return '✓';
  if (status === 'failed') return '!';
  if (status === 'active') return '…';
  if (status === 'skipped') return '·';
  return '○';
}

export function QdnTransactionFlow({
  title,
  state,
  onClose,
  onRetry,
  onCancel,
  successMessage,
  standalone = true,
}: QdnTransactionFlowProps) {
  const running = state.phase === 'idle' || state.phase === 'running';
  const showRetry = state.retryable && onRetry && state.phase !== 'idle';
  const showCancel = state.cancelable && onCancel && running;
  const showClose =
    state.phase === 'success' || state.phase === 'partial' || state.phase === 'failed';

  const content = (
    <div className="qdn-transaction" role="status" aria-live="polite">
      <ol className="qdn-transaction__chunks">
        {state.chunks.map((chunk) => (
          <li
            key={chunk.id}
            className={`qdn-transaction__chunk qdn-transaction__chunk--${chunk.status}`}
          >
            <span className="qdn-transaction__chunk-icon" aria-hidden="true">
              {statusIcon(chunk.status)}
            </span>
            <span className="qdn-transaction__chunk-label">{chunk.label}</span>
            {chunk.detail ? (
              <span className="qdn-transaction__chunk-detail">{chunk.detail}</span>
            ) : null}
            {chunk.error ? (
              <span className="qdn-transaction__chunk-error">{chunk.error}</span>
            ) : null}
          </li>
        ))}
      </ol>

      {state.error ? <p className="form-error">{state.error}</p> : null}
      {state.phase === 'success' && (
        <p className="form-success">{successMessage ?? state.successMessage ?? 'Completed.'}</p>
      )}
      {state.phase === 'partial' && (
        <p className="qdn-transaction__partial">
          The operation partially completed. Review the chunks above before retrying or closing.
        </p>
      )}

      <div className="form-actions">
        {showCancel ? (
          <button className="button button--secondary" type="button" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
        {showRetry ? (
          <button className="button button--primary" type="button" onClick={onRetry}>
            Retry
          </button>
        ) : null}
        {showClose ? (
          <button className="button button--primary" type="button" onClick={onClose}>
            Close
          </button>
        ) : null}
      </div>
    </div>
  );

  if (!standalone) {
    return content;
  }

  return (
    <Modal title={title} onClose={showClose ? onClose : running ? () => undefined : onClose}>
      {content}
    </Modal>
  );
}
