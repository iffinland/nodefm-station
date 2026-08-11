/* ============================================================
 * NodeFM Station — Playlists Page (Public)
 *
 * Browse public station playlists.
 * Phase 1: Shell only. Browser comes in Phase 2.
 * ============================================================ */

import { PageShell } from '../components/PageShell';

export default function PlaylistsPage() {
  return (
    <PageShell title="Playlists">
      <div className="playlists-page">
        <p className="playlists-page__placeholder">
          Public station playlists will appear here in Phase 2.
        </p>
      </div>
    </PageShell>
  );
}
