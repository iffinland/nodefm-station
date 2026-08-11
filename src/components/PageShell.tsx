/* ============================================================
 * NodeFM Station — Page Shell
 *
 * Consistent wrapper for page-level content.
 * ============================================================ */

import type { ReactNode } from 'react';

type PageShellProps = {
  title: string;
  children: ReactNode;
};

export function PageShell({ title, children }: PageShellProps) {
  return (
    <div className="page-shell">
      <h1 className="page-shell__title">{title}</h1>
      <div className="page-shell__content">{children}</div>
    </div>
  );
}
