/* ============================================================
 * NodeFM Station — Playlists Admin Page
 *
 * Playlist list management with CRUD.
 * Phase 2: create, list, navigate to editor.
 * ============================================================ */

import { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';
import { LoadingState } from '../../components/LoadingState';
import { ErrorState } from '../../components/ErrorState';
import { usePlaylists } from '../../hooks/usePlaylists';
import { useAuth } from '../../app/providers/authContext';

export default function PlaylistsAdminPage() {
  const { playlists, loaded, loading, error, createPlaylist, refresh } = usePlaylists();
  const { auth } = useAuth();
  const ownerAddress = auth.status === 'authenticated' ? auth.address : null;

  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newVisibility, setNewVisibility] = useState<'public' | 'private'>('private');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const handleCreate = useCallback(async () => {
    if (!newTitle.trim() || !ownerAddress) return;

    setCreating(true);
    setCreateError(null);

    try {
      await createPlaylist({
        title: newTitle.trim(),
        description: newDescription.trim() || undefined,
        visibility: newVisibility,
        ownerAddress,
      });
      setShowCreate(false);
      setNewTitle('');
      setNewDescription('');
      setNewVisibility('private');
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create playlist.');
    } finally {
      setCreating(false);
    }
  }, [newTitle, newDescription, newVisibility, ownerAddress, createPlaylist]);

  if (loading && !loaded) {
    return (
      <PageShell title="Playlists">
        <LoadingState message="Loading playlists…" />
      </PageShell>
    );
  }

  if (error && !loaded) {
    return (
      <PageShell title="Playlists">
        <ErrorState message="Failed to load playlists." detail={error} onRetry={refresh} />
      </PageShell>
    );
  }

  return (
    <PageShell title="Playlists">
      <div className="admin-playlists">
        <div className="admin-playlists__toolbar">
          <button
            className="button button--primary"
            type="button"
            onClick={() => setShowCreate(true)}
          >
            New Playlist
          </button>
          <span className="admin-playlists__count">
            {playlists.length} playlist{playlists.length !== 1 ? 's' : ''}
          </span>
        </div>

        {showCreate && (
          <div className="admin-playlists__create-form">
            <h3>Create Playlist</h3>
            <label className="form-field">
              Title
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Playlist name"
              />
            </label>
            <label className="form-field">
              Description
              <textarea
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                rows={2}
                placeholder="Optional description"
              />
            </label>
            <label className="form-field">
              Visibility
              <select
                value={newVisibility}
                onChange={(e) => setNewVisibility(e.target.value as 'public' | 'private')}
              >
                <option value="private">Private</option>
                <option value="public">Public</option>
              </select>
            </label>
            {createError && <p className="form-error">{createError}</p>}
            <div className="form-actions">
              <button
                className="button button--secondary"
                type="button"
                onClick={() => setShowCreate(false)}
              >
                Cancel
              </button>
              <button
                className="button button--primary"
                type="button"
                onClick={handleCreate}
                disabled={creating || !newTitle.trim()}
              >
                {creating ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        )}

        {playlists.length === 0 && !showCreate ? (
          <p className="admin-playlists__empty">
            No playlists yet. Create one to start building your station programming.
          </p>
        ) : (
          <div className="admin-playlists__list">
            {playlists.map((pl) => (
              <Link
                key={pl.playlistId}
                to={`/admin/playlists/${pl.playlistId}`}
                className="playlist-list-item"
              >
                <div className="playlist-list-item__info">
                  <h3>{pl.title}</h3>
                  {pl.description && <p>{pl.description}</p>}
                  <span
                    className={`playlist-list-item__visibility playlist-list-item__visibility--${pl.visibility}`}
                  >
                    {pl.visibility}
                  </span>
                  {pl.latestVersionId && (
                    <span className="playlist-list-item__published">Published</span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}
