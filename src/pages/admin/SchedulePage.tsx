/* ============================================================
 * NodeFM Station — Schedule Page (Admin)
 *
 * Week view and agenda view for scheduling.
 * Phase 1: Shell only. Scheduler comes in Phase 4.
 * ============================================================ */

import { PageShell } from '../../components/PageShell';

export default function SchedulePage() {
  return (
    <PageShell title="Schedule">
      <div className="admin-schedule">
        <p className="admin-schedule__placeholder">
          Schedule management will be available in Phase 4. You will be able to create, edit, and
          arrange schedule events using a week view and agenda view.
        </p>
      </div>
    </PageShell>
  );
}
