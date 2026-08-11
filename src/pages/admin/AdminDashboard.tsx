/* ============================================================
 * NodeFM Station — Admin Dashboard
 *
 * Station overview for the owner.
 * Phase 1: Shell with placeholder data.
 * ============================================================ */

import { PageShell } from '../../components/PageShell';

export default function AdminDashboard() {
  return (
    <PageShell title="Dashboard">
      <div className="admin-dashboard">
        <div className="admin-dashboard__grid">
          <div className="admin-dashboard__card">
            <h3>On Air</h3>
            <p className="admin-dashboard__value">—</p>
            <p className="admin-dashboard__hint">Default rotation active</p>
          </div>
          <div className="admin-dashboard__card">
            <h3>Next Program</h3>
            <p className="admin-dashboard__value">—</p>
            <p className="admin-dashboard__hint">No upcoming scheduled events</p>
          </div>
          <div className="admin-dashboard__card">
            <h3>Tracks in Library</h3>
            <p className="admin-dashboard__value">—</p>
            <p className="admin-dashboard__hint">Library coming in Phase 2</p>
          </div>
          <div className="admin-dashboard__card">
            <h3>Published Playlists</h3>
            <p className="admin-dashboard__value">—</p>
            <p className="admin-dashboard__hint">Playlists coming in Phase 2</p>
          </div>
        </div>

        <div className="admin-dashboard__actions">
          <h3>Quick Actions</h3>
          <div className="admin-dashboard__action-list">
            <span className="admin-dashboard__action-placeholder">Add Track</span>
            <span className="admin-dashboard__action-placeholder">Create Playlist</span>
            <span className="admin-dashboard__action-placeholder">Schedule Playlist</span>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
