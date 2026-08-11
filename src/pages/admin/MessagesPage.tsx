/* ============================================================
 * NodeFM Station — Messages Page (Admin)
 *
 * Listener messages directed to the station.
 * Phase 1: Shell only. Messaging comes in Phase 6.
 * ============================================================ */

import { PageShell } from '../../components/PageShell';

export default function MessagesPage() {
  return (
    <PageShell title="Messages">
      <div className="admin-messages">
        <p className="admin-messages__placeholder">
          Listener messages will appear here in Phase 6.
        </p>
      </div>
    </PageShell>
  );
}
