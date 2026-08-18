/* ============================================================
 * NodeFM Station — Playlist Editor Page (Admin)
 *
 * Full playlist editor with:
 * - Track add/remove
 * - Drag-and-drop reordering
 * - Duration calculation
 * - Publish immutable version
 * - Version history
 * - Draft/public state
 * ============================================================ */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';
import { LoadingState } from '../../components/LoadingState';
import { ErrorState } from '../../components/ErrorState';
import { usePlaylists } from '../../hooks/usePlaylists';
import { useLibrary } from '../../hooks/useLibrary';
import { useAuth } from '../../app/providers/authContext';
import { formatDurationMs, calculateTotalDurationMs } from '../../utils/duration';
import {
  isPlaylistPublishable,
  createTrackSnapshot,
} from '../../features/playlists/services/playlistService';
import {
  getPlaylistDraft,
  savePlaylistDraft,
  clearPlaylistDraft,
  type PlaylistDraftTrack,
} from '../../features/playlists/services/playlistDraftStore';
import type { Track, PlaylistVersionTrack } from '../../types/domain';
import type { EditPlaylistInput } from '../../features/playlists/services/playlistService';

export default function PlaylistEditorPage() {
  const { playlistId } = useParams<{ playlistId: string }>();
  const navigate = useNavigate();
  const { auth } = useAuth();
  const ownerAddress = auth.status === 'authenticated' ? auth.address : null;

  const {
    loaded: plLoaded,
    loading: plLoading,
    error: plError,
    getPlaylist,
    getVersions,
    getLatestVersion,
    editPlaylist,
    duplicatePlaylist,
    publishVersion,
    refresh: refreshPlaylists,
  } = usePlaylists();
  const { tracks: libraryTracks, loaded: libLoaded } = useLibrary();

  const playlist = playlistId ? getPlaylist(playlistId) : undefined;
  const versions = playlistId ? getVersions(playlistId) : [];
  const latestVersion = playlistId ? getLatestVersion(playlistId) : undefined;

  const [draftTracks, setDraftTracks] = useState<PlaylistDraftTrack[]>([]);
  const [draftInitialized, setDraftInitialized] = useState(false);
  const [draftOwnerAddress, setDraftOwnerAddress] = useState<string | null>(null);
  const [editingMeta, setEditingMeta] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editVisibility, setEditVisibility] = useState<'public' | 'private'>('private');
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publishResult, setPublishResult] = useState<string | null>(null);
  const [showAddTracks, setShowAddTracks] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  // Reset editor-local draft state whenever the account or playlist changes.
  useEffect(() => {
    setDraftTracks([]);
    setDraftInitialized(false);
    setDraftOwnerAddress(null);
    setEditingMeta(false);
    setError(null);
    setPublishResult(null);
    setShowAddTracks(false);
    setDragIndex(null);
  }, [ownerAddress, playlistId]);

  useEffect(() => {
    if (draftInitialized || !playlist || !libLoaded) return;

    const storedDraft = ownerAddress
      ? getPlaylistDraft(ownerAddress, playlist.playlistId)
      : undefined;

    if (storedDraft !== undefined) {
      setDraftTracks(storedDraft);
    } else if (latestVersion && latestVersion.tracks.length > 0) {
      const mapped: PlaylistDraftTrack[] = [];
      for (const vt of latestVersion.tracks) {
        const track = libraryTracks.find((t) => t.trackId === vt.trackId);
        if (track) {
          mapped.push({
            trackId: track.trackId,
            durationMs: track.durationMs,
            title: track.title,
            artist: track.artist,
          });
        }
      }
      setDraftTracks(mapped);
    }

    setEditTitle(playlist.title);
    setEditDescription(playlist.description ?? '');
    setEditVisibility(playlist.visibility);
    setDraftOwnerAddress(ownerAddress);
    setDraftInitialized(true);
  }, [playlist, latestVersion, libraryTracks, libLoaded, draftInitialized, ownerAddress]);

  useEffect(() => {
    if (!draftInitialized || draftOwnerAddress !== ownerAddress || !playlist || !ownerAddress) {
      return;
    }

    savePlaylistDraft(ownerAddress, playlist.playlistId, draftTracks);
  }, [draftInitialized, draftOwnerAddress, ownerAddress, playlist, draftTracks]);

  const totalDurationMs = useMemo(
    () => calculateTotalDurationMs(draftTracks.map((t) => t.durationMs)),
    [draftTracks],
  );

  const isDirty = useMemo(() => {
    if (!latestVersion) return draftTracks.length > 0;
    if (draftTracks.length !== latestVersion.tracks.length) return true;
    return draftTracks.some((dt, i) => dt.trackId !== latestVersion.tracks[i].trackId);
  }, [draftTracks, latestVersion]);

  const publishableCheck = useMemo(
    () =>
      isPlaylistPublishable(
        draftTracks.map((t) => ({ trackId: t.trackId, durationMs: t.durationMs })),
      ),
    [draftTracks],
  );

  const handleSaveMeta = useCallback(async () => {
    if (!playlist) return;
    setSaving(true);
    setError(null);

    try {
      const input: EditPlaylistInput = {
        title: editTitle,
        description: editDescription || undefined,
        visibility: editVisibility,
      };
      await editPlaylist(playlist.playlistId, input);
      setEditingMeta(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  }, [playlist, editTitle, editDescription, editVisibility, editPlaylist]);

  const handleAddTrack = useCallback(
    (track: Track) => {
      if (draftTracks.some((dt) => dt.trackId === track.trackId)) return;
      setDraftTracks((prev) => [
        ...prev,
        {
          trackId: track.trackId,
          durationMs: track.durationMs,
          title: track.title,
          artist: track.artist,
        },
      ]);
    },
    [draftTracks],
  );

  const handleRemoveTrack = useCallback((trackId: string) => {
    setDraftTracks((prev) => prev.filter((t) => t.trackId !== trackId));
  }, []);

  const handleDragStart = useCallback((index: number) => {
    setDragIndex(index);
  }, []);

  const handleDragOver = useCallback(
    (index: number) => {
      if (dragIndex === null || dragIndex === index) return;

      setDraftTracks((prev) => {
        const next = [...prev];
        const [moved] = next.splice(dragIndex, 1);
        next.splice(index, 0, moved);
        return next;
      });
      setDragIndex(index);
    },
    [dragIndex],
  );

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
  }, []);

  const handlePublish = useCallback(async () => {
    if (!playlist || !ownerAddress) return;
    setPublishing(true);
    setError(null);
    setPublishResult(null);

    const snapshot: PlaylistVersionTrack[] = createTrackSnapshot(draftTracks);

    const result = await publishVersion({
      playlistId: playlist.playlistId,
      createdBy: ownerAddress,
      tracks: snapshot,
      lastVersion: latestVersion,
    });

    if (result.ok) {
      clearPlaylistDraft(ownerAddress, playlist.playlistId);
      setPublishResult(`Version ${result.version.versionNumber} published successfully.`);
    } else if ('partial' in result && result.partial) {
      setPublishResult(
        `Version published but playlist update had an issue: ${result.error}. The version ID is safe.`,
      );
    } else {
      setError(result.error);
    }

    setPublishing(false);
  }, [playlist, ownerAddress, draftTracks, latestVersion, publishVersion]);

  const handleDuplicate = useCallback(async () => {
    if (!playlist) return;
    try {
      await duplicatePlaylist(playlist.playlistId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to duplicate.');
    }
  }, [playlist, duplicatePlaylist]);

  if (plLoading || !draftInitialized) {
    return (
      <PageShell title="Playlist Editor">
        <LoadingState message="Loading playlist…" />
      </PageShell>
    );
  }

  if (plError && !plLoaded) {
    return (
      <PageShell title="Playlist Editor">
        <ErrorState
          message="Failed to load playlist."
          detail={plError}
          onRetry={refreshPlaylists}
        />
      </PageShell>
    );
  }

  if (!playlist) {
    return (
      <PageShell title="Playlist Editor">
        <ErrorState message="Playlist not found." onRetry={() => navigate('/admin/playlists')} />
      </PageShell>
    );
  }

  return (
    <PageShell title={`Playlist: ${playlist.title}`}>
      <div className="playlist-editor">
        <div className="playlist-editor__header">
          {editingMeta ? (
            <div className="playlist-editor__meta-form">
              <label className="form-field">
                Title
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                />
              </label>
              <label className="form-field">
                Description
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  rows={2}
                />
              </label>
              <label className="form-field">
                Visibility
                <select
                  value={editVisibility}
                  onChange={(e) => setEditVisibility(e.target.value as 'public' | 'private')}
                >
                  <option value="private">Private</option>
                  <option value="public">Public</option>
                </select>
              </label>
              <div className="form-actions">
                <button
                  className="button button--secondary"
                  type="button"
                  onClick={() => setEditingMeta(false)}
                >
                  Cancel
                </button>
                <button
                  className="button button--primary"
                  type="button"
                  onClick={handleSaveMeta}
                  disabled={saving}
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          ) : (
            <div className="playlist-editor__meta-display">
              <div>
                <h2>{playlist.title}</h2>
                {playlist.description && <p>{playlist.description}</p>}
                <span
                  className={`playlist-editor__visibility playlist-editor__visibility--${playlist.visibility}`}
                >
                  {playlist.visibility}
                </span>
                {latestVersion && (
                  <span className="playlist-editor__version-info">
                    Latest: v{latestVersion.versionNumber}
                  </span>
                )}
              </div>
              <div className="playlist-editor__header-actions">
                <button
                  className="button button--secondary"
                  type="button"
                  onClick={() => setEditingMeta(true)}
                >
                  Edit Info
                </button>
                <button
                  className="button button--secondary"
                  type="button"
                  onClick={handleDuplicate}
                >
                  Duplicate
                </button>
              </div>
            </div>
          )}
        </div>

        {error && <p className="form-error">{error}</p>}
        {publishResult && <p className="form-success">{publishResult}</p>}

        <div className="playlist-editor__stats">
          <span>{draftTracks.length} tracks</span>
          <span>Total: {formatDurationMs(totalDurationMs)}</span>
          {!publishableCheck.publishable && (
            <span className="playlist-editor__stats-warning">{publishableCheck.reason}</span>
          )}
          {isDirty && <span className="playlist-editor__stats-dirty">Unsaved draft</span>}
        </div>

        <div className="playlist-editor__actions">
          <button
            className="button button--secondary"
            type="button"
            onClick={() => setShowAddTracks(!showAddTracks)}
          >
            {showAddTracks ? 'Close' : 'Add Tracks'}
          </button>
          <button
            className="button button--primary"
            type="button"
            onClick={handlePublish}
            disabled={publishing || !publishableCheck.publishable}
          >
            {publishing
              ? 'Publishing…'
              : `Publish Version ${(latestVersion?.versionNumber ?? 0) + 1}`}
          </button>
        </div>

        {showAddTracks && (
          <div className="playlist-editor__add-panel">
            <h3>Library Tracks</h3>
            {libraryTracks.length === 0 ? (
              <p>No tracks in library. Upload or add QDN audio first.</p>
            ) : (
              <div className="playlist-editor__library-list">
                {libraryTracks.map((track) => {
                  const alreadyAdded = draftTracks.some((dt) => dt.trackId === track.trackId);
                  return (
                    <div key={track.trackId} className="playlist-editor__library-item">
                      <span>{track.title}</span>
                      {track.artist && (
                        <span className="playlist-editor__library-item-artist">{track.artist}</span>
                      )}
                      <span>{formatDurationMs(track.durationMs)}</span>
                      <button
                        className="button button--secondary"
                        type="button"
                        onClick={() => handleAddTrack(track)}
                        disabled={alreadyAdded}
                      >
                        {alreadyAdded ? 'Added' : 'Add'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div className="playlist-editor__track-list">
          {draftTracks.length === 0 ? (
            <p className="playlist-editor__empty">
              No tracks in this playlist yet. Add tracks from the library above.
            </p>
          ) : (
            draftTracks.map((dt, index) => (
              <div
                key={dt.trackId}
                className={`playlist-editor__track-item ${dragIndex === index ? 'playlist-editor__track-item--dragging' : ''}`}
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragOver={(e) => {
                  e.preventDefault();
                  handleDragOver(index);
                }}
                onDragEnd={handleDragEnd}
              >
                <span className="playlist-editor__drag-handle" aria-hidden="true">
                  ⠿
                </span>
                <span className="playlist-editor__track-num">{index + 1}</span>
                <div className="playlist-editor__track-info">
                  <strong>{dt.title}</strong>
                  {dt.artist && <span> — {dt.artist}</span>}
                </div>
                <span className="playlist-editor__track-duration">
                  {formatDurationMs(dt.durationMs)}
                </span>
                <button
                  className="button button--secondary playlist-editor__remove-btn"
                  type="button"
                  onClick={() => handleRemoveTrack(dt.trackId)}
                  title="Remove from playlist"
                >
                  ✕
                </button>
              </div>
            ))
          )}
        </div>

        {versions.length > 0 && (
          <div className="playlist-editor__versions">
            <h3>Published Versions</h3>
            <div className="playlist-editor__version-list">
              {[...versions].reverse().map((v) => (
                <div
                  key={v.versionId}
                  className={`playlist-editor__version-item ${v.versionId === latestVersion?.versionId ? 'playlist-editor__version-item--latest' : ''}`}
                >
                  <span>
                    <strong>v{v.versionNumber}</strong>
                  </span>
                  <span>{v.tracks.length} tracks</span>
                  <span>{formatDurationMs(v.totalDurationMs)}</span>
                  <span>{new Date(v.createdAt).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </PageShell>
  );
}
