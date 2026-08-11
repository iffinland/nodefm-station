/* ============================================================
 * NodeFM Station — Library Page (Admin)
 *
 * Music library management.
 * Phase 1: Shell only. Full library comes in Phase 2.
 * ============================================================ */

import { PageShell } from '../../components/PageShell';

export default function LibraryPage() {
  return (
    <PageShell title="Library">
      <div className="admin-library">
        <div className="admin-library__toolbar">
          <span className="button button--primary" aria-disabled="true">
            Upload Audio
          </span>
          <span className="button button--secondary" aria-disabled="true">
            Add from QDN
          </span>
        </div>
        <p className="admin-library__placeholder">
          Track library will be available in Phase 2. You will be able to upload audio, add existing
          QDN resources, and manage track metadata here.
        </p>
      </div>
    </PageShell>
  );
}
