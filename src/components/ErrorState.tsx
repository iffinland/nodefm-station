/* ============================================================
 * NodeFM Station — Error State
 *
 * Reusable error display with optional retry action.
 * ============================================================ */

import type { ReactNode } from 'react';

type ErrorStateProps = {
  message?: string;
  detail?: string;
  onRetry?: () => void;
  children?: ReactNode;
};

export function ErrorState({
  message = 'Something went wrong.',
  detail,
  onRetry,
  children,
}: ErrorStateProps) {
  return (
    <div className="error-state" role="alert">
      <div className="error-state__icon" aria-hidden="true">
        !
      </div>
      <p className="error-state__message">{message}</p>
      {detail ? <p className="error-state__detail">{detail}</p> : null}
      <div className="error-state__actions">
        {onRetry ? (
          <button className="button button--primary" type="button" onClick={onRetry}>
            Retry
          </button>
        ) : null}
        {children}
      </div>
    </div>
  );
}
