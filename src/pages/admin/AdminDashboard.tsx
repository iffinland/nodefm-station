/* ============================================================
 * NodeFM Station — Admin Dashboard
 *
 * Station overview for the owner.
 * Phase 1: Shell with placeholder data.
 * ============================================================ */

import { PageShell } from '../../components/PageShell';
import { useLiveRadioPlayerContext } from '../../features/radio/player';
import { useStation } from '../../features/station';

export default function AdminDashboard() {
  const { timeline } = useLiveRadioPlayerContext();
  const { station } = useStation();
  const liveState = timeline.liveState;

  return (
    <PageShell title={station?.name ?? 'Dashboard'}>
      <div className="admin-dashboard">
        <div className="admin-dashboard__grid">
          <div className="admin-dashboard__card">
            <h3>On Air</h3>
            <p className="admin-dashboard__value">{timeline.currentTrack?.title ?? '—'}</p>
            <p className="admin-dashboard__hint">
              {liveState?.programTitle ??
                (liveState?.mode === 'default-rotation'
                  ? 'Default rotation active'
                  : 'Live timeline unavailable')}
            </p>
          </div>
          <div className="admin-dashboard__card">
            <h3>Next Program</h3>
            <p className="admin-dashboard__value">—</p>
            <p className="admin-dashboard__hint">No upcoming scheduled events</p>
          </div>
          <div className="admin-dashboard__card">
            <h3>Tracks in Library</h3>
            <p className="admin-dashboard__value">—</p>
            <p className="admin-dashboard__hint">Library loaded in admin area</p>
          </div>
          <div className="admin-dashboard__card">
            <h3>Published Playlists</h3>
            <p className="admin-dashboard__value">—</p>
            <p className="admin-dashboard__hint">Published versions managed in Playlists</p>
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
