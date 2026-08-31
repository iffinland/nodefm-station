/* ============================================================
 * NodeFM Station — Publication Progress
 *
 * Shared presentation for coordinated QDN publication writes.
 *
 * This is the canonical visual pattern used by the Admin Upload
 * Audio flow. It is deliberately presentation-only: feature code
 * owns the operation and advances `PublicationProgressState`.
 *
 * Rows use the same status vocabulary across every caller:
 *   waiting   -> pending marker
 *   active    -> animated spinner
 *   succeeded -> check mark
 *   failed    -> failure marker
 *
 * The Close button is only shown once the publication has finished
 * (success or failure). Publication modals intentionally do not
 * expose a Retry action.
 * ============================================================ */

import type { ReactNode } from 'react';
import { Modal } from './Modal';

export type PublicationRowStatus = 'waiting' | 'active' | 'succeeded' | 'failed';

export type PublicationPhase = 'publishing' | 'success' | 'failed';

export type PublicationRow = {
  id: string;
  label: string;
  status: PublicationRowStatus;
  error?: string;
};

export type PublicationProgressState = {
  phase: PublicationPhase;
  rows: PublicationRow[];
  error?: string;
};

type PublicationProgressProps = {
  title: string;
  state: PublicationProgressState;
  successMessage?: string;
  onClose: () => void;
  onSuccess?: () => void;
  standalone?: boolean;
};

function rowIndicator(status: PublicationRowStatus): ReactNode {
  if (status === 'active') {
    return <span className="upload-publication__spinner" />;
  }

  if (status === 'succeeded') {
    return '✓';
  }

  if (status === 'failed') {
    return '!';
  }

  return '•';
}

export function PublicationProgress({
  title,
  state,
  successMessage = 'Completed.',
  onClose,
  onSuccess,
  standalone = true,
}: PublicationProgressProps) {
  const showClose = state.phase === 'success' || state.phase === 'failed';

  const content = (
    <div className="upload-publication" role="status" aria-live="polite">
      <ol className="upload-publication__rows">
        {state.rows.map((row) => (
          <li
            key={row.id}
            className={`upload-publication__row upload-publication__row--${row.status}`}
          >
            <span className="upload-publication__status" aria-hidden="true">
              {rowIndicator(row.status)}
            </span>
            <span className="upload-publication__label">{row.label}</span>
            {row.error ? <span className="upload-publication__error">{row.error}</span> : null}
          </li>
        ))}
      </ol>

      {state.error ? <p className="form-error">{state.error}</p> : null}
      {state.phase === 'success' ? <p className="form-success">{successMessage}</p> : null}

      <div className="form-actions">
        {showClose ? (
          <button
            className="button button--primary"
            type="button"
            onClick={state.phase === 'success' ? (onSuccess ?? onClose) : onClose}
          >
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
    <Modal title={title} onClose={onClose}>
      {content}
    </Modal>
  );
}
