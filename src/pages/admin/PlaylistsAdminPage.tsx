/* ============================================================
 * NodeFM Station — Playlists Admin Page
 *
 * Playlist list management.
 * Phase 1: Shell only. Playlist CRUD comes in Phase 2.
 * ============================================================ */

import { Link } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';

export default function PlaylistsAdminPage() {
  return (
    <PageShell title="Playlists">
      <div className="admin-playlists">
        <div className="admin-playlists__toolbar">
          <span className="button button--primary" aria-disabled="true">
            New Playlist
          </span>
        </div>
        <p className="admin-playlists__placeholder">
          Playlist management will be available in Phase 2.
        </p>
        <p className="admin-playlists__hint">
          Once created, you can edit playlists at{' '}
          <Link to="/admin/playlists/new">/admin/playlists/:playlistId</Link>.
        </p>
      </div>
    </PageShell>
  );
}
