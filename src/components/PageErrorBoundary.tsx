/* ============================================================
 * NodeFM Station — Page Error Boundary
 *
 * Route-level error boundary that keeps the application shell and
 * global audio provider alive when one page throws. The boundary is
 * keyed by route in Layout so navigating away clears the previous
 * page error instead of permanently replacing the page area.
 * ============================================================ */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ErrorState } from './ErrorState';

type PageErrorBoundaryProps = {
  children: ReactNode;
};

type PageErrorBoundaryState = {
  error: Error | null;
};

export class PageErrorBoundary extends Component<PageErrorBoundaryProps, PageErrorBoundaryState> {
  state: PageErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): PageErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Preserve the real exception for developer diagnostics instead of
    // silently swallowing it.
    console.error('Page render failed:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="page-shell">
          <ErrorState message="This page could not be rendered." detail={this.state.error.message}>
            <Link className="button button--secondary" to="/">
              Return to station
            </Link>
          </ErrorState>
        </div>
      );
    }

    return this.props.children;
  }
}
