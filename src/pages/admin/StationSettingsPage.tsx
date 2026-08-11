/* ============================================================
 * NodeFM Station — Station Settings Page (Admin)
 *
 * Station identity, owner/payment config, default rotation.
 * Phase 1: Shell only. Settings come in Phase 3+.
 * ============================================================ */

import { PageShell } from '../../components/PageShell';

export default function StationSettingsPage() {
  return (
    <PageShell title="Station Settings">
      <div className="admin-station-settings">
        <p className="admin-station-settings__placeholder">
          Station configuration will be available in Phase 3. You will be able to configure station
          identity, owner/payment info, default rotation playlist, and station epoch.
        </p>
      </div>
    </PageShell>
  );
}
