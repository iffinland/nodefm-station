/* ============================================================
 * NodeFM Station — Playlist Editor Page (Admin)
 *
 * Edit a single playlist.
 * Phase 1: Shell only. Editor comes in Phase 2.
 * ============================================================ */

import { useParams } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';

export default function PlaylistEditorPage() {
  const { playlistId } = useParams<{ playlistId: string }>();

  return (
    <PageShell title={playlistId === 'new' ? 'New Playlist' : `Playlist: ${playlistId}`}>
      <div className="admin-playlist-editor">
        <p className="admin-playlist-editor__placeholder">
          Playlist editor will be available in Phase 2. Drag-and-drop reordering, track management,
          and version publishing will be supported.
        </p>
      </div>
    </PageShell>
  );
}
