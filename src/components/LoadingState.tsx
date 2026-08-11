/* ============================================================
 * NodeFM Station — Loading State
 *
 * Reusable loading indicator for slow QDN resources.
 * ============================================================ */

type LoadingStateProps = {
  message?: string;
  overlay?: boolean;
};

export function LoadingState({ message = 'Loading…', overlay = false }: LoadingStateProps) {
  return (
    <div className={`loading-state${overlay ? ' loading-state--overlay' : ''}`} role="status">
      <div className="loading-state__spinner" aria-hidden="true" />
      <p className="loading-state__message">{message}</p>
    </div>
  );
}
