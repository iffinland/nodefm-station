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
import { QdnTransactionFlow } from '../../components/QdnTransactionFlow';
import {
  createQdnTransactionState,
  markQdnTransactionChunkActive,
  type QdnTransactionState,
} from '../../components/qdnTransactionFlow';
import { usePlaylists } from '../../hooks/usePlaylists';
import { useLibrary } from '../../hooks/useLibrary';
import { useStation, useStationIdentity } from '../../features/station';
import { useScheduler } from '../../features/scheduling';
import { formatDurationMs, calculateTotalDurationMs } from '../../utils/duration';
import { rotateArray, shuffleArray } from '../../utils/deterministicShuffle';
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
import { findPlaylistVersionReferences } from '../../features/playlists/services/playlistVersionReferenceService';
import {
  TrackFilterBar,
  TrackMetadataLine,
  TrackPrimaryLine,
  useTrackFiltering,
} from '../../features/tracks';
import type { Track, PlaylistVersionTrack } from '../../types/domain';
import type { EditPlaylistInput } from '../../features/playlists/services/playlistService';

export default function PlaylistEditorPage() {
  const { playlistId } = useParams<{ playlistId: string }>();
  const navigate = useNavigate();
  const { ownerAddress } = useStationIdentity();
  const { station } = useStation();
  const {
    events: scheduleEvents,
    recurrences: scheduleRecurrences,
    loaded: scheduleLoaded,
  } = useScheduler();

  const {
    loaded: plLoaded,
    loading: plLoading,
    error: plError,
    revision: playlistStoreRevision,
    getPlaylist,
    getVersions,
    getLatestVersion,
    editPlaylist,
    duplicatePlaylist,
    publishVersion,
    deleteVersion,
    restoreVersionAsLatest,
    refresh: refreshPlaylists,
  } = usePlaylists();
  const { tracks: libraryTracks, loaded: libLoaded } = useLibrary();
  const trackFiltering = useTrackFiltering(libraryTracks);

  const playlist = playlistId ? getPlaylist(playlistId) : undefined;
  // `playlistStoreRevision` is a deliberate cache-buster for the store's
  // version list; the hook already returns a stable `getVersions` function.
  const versions = useMemo(
    () => (playlistId ? getVersions(playlistId) : []),
    [getVersions, playlistId, playlistStoreRevision], // eslint-disable-line react-hooks/exhaustive-deps
  );
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
  const [transaction, setTransaction] = useState<QdnTransactionState | null>(null);
  const [transactionTitle, setTransactionTitle] = useState('Publish Playlist Version');
  const [versionActionBusy, setVersionActionBusy] = useState<string | null>(null);
  const [versionActionResult, setVersionActionResult] = useState<string | null>(null);
  const [showAddTracks, setShowAddTracks] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const beginTransaction = useCallback((title: string, label: string) => {
    setTransactionTitle(title);
    setTransaction(createQdnTransactionState([{ id: 'write', label }], { retryable: true }));
    setTransaction((current) =>
      current ? markQdnTransactionChunkActive(current, 'write') : current,
    );
  }, []);

  const finishTransactionSuccess = useCallback((message: string) => {
    setTransaction((current) =>
      current
        ? {
            ...current,
            chunks: current.chunks.map((item) => ({ ...item, status: 'succeeded' as const })),
            phase: 'success' as const,
            successMessage: message,
            retryable: false,
          }
        : current,
    );
  }, []);

  const finishTransactionError = useCallback((error: unknown, fallback: string) => {
    const message = error instanceof Error ? error.message : fallback;
    setTransaction((current) =>
      current
        ? {
            ...current,
            chunks: current.chunks.map((item) =>
              item.status === 'active' ? { ...item, status: 'failed' as const } : item,
            ),
            phase: 'failed' as const,
            error: message,
            retryable: true,
          }
        : current,
    );
    return message;
  }, []);

  // Reset editor-local draft state whenever the account or playlist changes.
  useEffect(() => {
    setDraftTracks([]);
    setDraftInitialized(false);
    setDraftOwnerAddress(null);
    setEditingMeta(false);
    setError(null);
    setPublishResult(null);
    setTransaction(null);
    setVersionActionBusy(null);
    setVersionActionResult(null);
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

  const versionReferences = useMemo(() => {
    const map = new Map<string, ReturnType<typeof findPlaylistVersionReferences>>();

    if (!playlist) return map;

    for (const version of versions) {
      map.set(
        version.versionId,
        findPlaylistVersionReferences({
          versionId: version.versionId,
          playlists: [playlist],
          scheduleEvents,
          scheduleRecurrences,
          station,
        }),
      );
    }

    return map;
  }, [playlist, scheduleEvents, scheduleRecurrences, station, versions]);

  const handleSaveMeta = useCallback(async () => {
    if (!playlist) return;
    setSaving(true);
    setError(null);
    beginTransaction('Save Playlist', 'Update playlist metadata');

    try {
      const input: EditPlaylistInput = {
        title: editTitle,
        description: editDescription || undefined,
        visibility: editVisibility,
      };
      await editPlaylist(playlist.playlistId, input);
      finishTransactionSuccess('Playlist metadata saved.');
      setEditingMeta(false);
    } catch (err) {
      setError(finishTransactionError(err, 'Failed to save.'));
    } finally {
      setSaving(false);
    }
  }, [
    beginTransaction,
    editPlaylist,
    editDescription,
    editTitle,
    editVisibility,
    finishTransactionError,
    finishTransactionSuccess,
    playlist,
  ]);

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

  const handleShuffleDraft = useCallback(() => {
    setDraftTracks((previous) => shuffleArray(previous));
  }, []);

  const handleRotateDraft = useCallback(() => {
    setDraftTracks((previous) => rotateArray(previous, 1));
  }, []);

  const handlePublish = useCallback(async () => {
    if (!playlist || !ownerAddress) return;
    setPublishing(true);
    setError(null);
    setPublishResult(null);
    setTransactionTitle('Publish Playlist Version');
    setTransaction(
      createQdnTransactionState(
        [
          { id: 'version', label: 'Publish immutable playlist version' },
          { id: 'pointer', label: 'Update playlist pointer' },
        ],
        { retryable: true },
      ),
    );

    const snapshot: PlaylistVersionTrack[] = createTrackSnapshot(draftTracks);

    const result = await publishVersion(
      {
        playlistId: playlist.playlistId,
        createdBy: ownerAddress,
        tracks: snapshot,
        lastVersion: latestVersion,
      },
      (chunk) => {
        setTransaction((current) =>
          current ? markQdnTransactionChunkActive(current, chunk) : current,
        );
      },
    );

    if (result.ok) {
      clearPlaylistDraft(ownerAddress, playlist.playlistId);
      setPublishResult(`Version ${result.version.versionNumber} published successfully.`);
      setTransaction((current) =>
        current
          ? {
              ...current,
              chunks: current.chunks.map((item) => ({ ...item, status: 'succeeded' as const })),
              phase: 'success' as const,
              successMessage: `Version ${result.version.versionNumber} published successfully.`,
              retryable: false,
            }
          : current,
      );
    } else if ('partial' in result && result.partial) {
      setTransaction((current) =>
        current
          ? {
              ...current,
              chunks: current.chunks.map((item) =>
                item.status === 'active' ? { ...item, status: 'failed' as const } : item,
              ),
              phase: 'partial' as const,
              error: result.error,
              retryable: true,
            }
          : current,
      );
    } else {
      setError(result.error);
      setTransaction((current) =>
        current
          ? {
              ...current,
              chunks: current.chunks.map((item) =>
                item.status === 'active' ? { ...item, status: 'failed' as const } : item,
              ),
              phase: 'failed' as const,
              error: result.error,
              retryable: true,
            }
          : current,
      );
    }

    setPublishing(false);
  }, [playlist, ownerAddress, draftTracks, latestVersion, publishVersion]);

  const handleDuplicate = useCallback(async () => {
    if (!playlist) return;
    beginTransaction('Duplicate Playlist', 'Duplicate playlist');
    try {
      await duplicatePlaylist(playlist.playlistId);
      finishTransactionSuccess('Playlist duplicated.');
    } catch (err) {
      setError(finishTransactionError(err, 'Failed to duplicate.'));
    }
  }, [
    beginTransaction,
    duplicatePlaylist,
    finishTransactionError,
    finishTransactionSuccess,
    playlist,
  ]);

  const handleDeleteVersion = useCallback(
    async (versionId: string) => {
      if (!playlist || versionActionBusy) return;

      setVersionActionBusy(`delete:${versionId}`);
      setVersionActionResult(null);
      setError(null);
      beginTransaction('Delete Playlist Version', 'Delete playlist version');

      try {
        await deleteVersion(versionId);
        finishTransactionSuccess('Version deleted successfully.');
        setVersionActionResult('Version deleted successfully.');
      } catch (err) {
        setError(finishTransactionError(err, 'Failed to delete playlist version.'));
      } finally {
        setVersionActionBusy(null);
      }
    },
    [
      beginTransaction,
      deleteVersion,
      finishTransactionError,
      finishTransactionSuccess,
      playlist,
      versionActionBusy,
    ],
  );

  const handleRestoreVersion = useCallback(
    async (versionId: string) => {
      if (!playlist || versionActionBusy) return;

      setVersionActionBusy(`restore:${versionId}`);
      setVersionActionResult(null);
      setError(null);
      beginTransaction('Restore Playlist Version', 'Restore version as latest');

      try {
        await restoreVersionAsLatest(playlist.playlistId, versionId);
        finishTransactionSuccess('Version restored as latest.');
        setVersionActionResult('Version restored as latest.');
      } catch (err) {
        setError(finishTransactionError(err, 'Failed to restore playlist version.'));
      } finally {
        setVersionActionBusy(null);
      }
    },
    [
      beginTransaction,
      finishTransactionError,
      finishTransactionSuccess,
      playlist,
      restoreVersionAsLatest,
      versionActionBusy,
    ],
  );

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
          <button className="button button--secondary" type="button" onClick={handleShuffleDraft}>
            Shuffle
          </button>
          <button className="button button--secondary" type="button" onClick={handleRotateDraft}>
            Rotate Start
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
              <>
                <TrackFilterBar
                  filters={trackFiltering.filters}
                  sort={trackFiltering.sort}
                  options={trackFiltering.options}
                  resultCount={trackFiltering.visibleTracks.length}
                  totalCount={libraryTracks.length}
                  onFilterChange={trackFiltering.setFilter}
                  onSortChange={trackFiltering.setSort}
                  onClearFilters={trackFiltering.clearFilters}
                />
                {trackFiltering.visibleTracks.length === 0 ? (
                  <p className="playlist-editor__empty">
                    No library tracks match the current search or filters.
                  </p>
                ) : (
                  <div className="playlist-editor__library-list">
                    {trackFiltering.visibleTracks.map((track) => {
                      const alreadyAdded = draftTracks.some((dt) => dt.trackId === track.trackId);
                      return (
                        <div key={track.trackId} className="playlist-editor__library-item">
                          <div className="playlist-editor__library-item-main">
                            <TrackPrimaryLine
                              track={track}
                              className="playlist-editor__library-item-title"
                            />
                            <TrackMetadataLine
                              track={track}
                              className="playlist-editor__library-item-taxonomy"
                            />
                          </div>
                          <span className="playlist-editor__library-item-duration">
                            {formatDurationMs(track.durationMs)}
                          </span>
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
              </>
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
                  <strong>
                    <TrackPrimaryLine track={dt} />
                  </strong>
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
            {versionActionResult && <p className="form-success">{versionActionResult}</p>}
            <div className="playlist-editor__version-list">
              {[...versions].reverse().map((v) => {
                const isLatest = v.versionId === playlist.latestVersionId;
                const isDefault = station?.defaultRotationPlaylistVersionId === v.versionId;
                const references = versionReferences.get(v.versionId) ?? [];
                const hasBlockingReference = references.length > 0 || isLatest || isDefault;
                const canDelete = !isLatest && !hasBlockingReference && scheduleLoaded;
                const busyKey = versionActionBusy;

                return (
                  <div
                    key={v.versionId}
                    className={`playlist-editor__version-item ${isLatest ? 'playlist-editor__version-item--latest' : ''}`}
                  >
                    <div className="playlist-editor__version-item__main">
                      <span>
                        <strong>v{v.versionNumber}</strong>
                        {isLatest && (
                          <span className="playlist-editor__version-badge">CURRENT</span>
                        )}
                        {isDefault && (
                          <span className="playlist-editor__version-badge">DEFAULT ROTATION</span>
                        )}
                      </span>
                      <span>{v.tracks.length} tracks</span>
                      <span>{formatDurationMs(v.totalDurationMs)}</span>
                      <span>{new Date(v.createdAt).toLocaleString()}</span>
                      <span>
                        {references.length > 0
                          ? `Referenced by ${references
                              .map((reference) => reference.label || reference.id)
                              .join(', ')}`
                          : scheduleLoaded
                            ? 'Not referenced elsewhere'
                            : 'Checking schedule references…'}
                      </span>
                    </div>

                    <div className="playlist-editor__version-item__actions">
                      {!isLatest && (
                        <button
                          className="button button--secondary"
                          type="button"
                          onClick={() => handleRestoreVersion(v.versionId)}
                          disabled={versionActionBusy !== null}
                        >
                          Make Latest
                        </button>
                      )}
                      {canDelete && (
                        <button
                          className="button button--secondary playlist-editor__delete-btn"
                          type="button"
                          onClick={() => handleDeleteVersion(v.versionId)}
                          disabled={versionActionBusy !== null}
                        >
                          Delete
                        </button>
                      )}
                      {isLatest && <span className="playlist-editor__version-locked">Latest</span>}
                      {!canDelete && !isLatest && hasBlockingReference && (
                        <span className="playlist-editor__version-locked">Delete blocked</span>
                      )}
                      {!canDelete && !isLatest && !hasBlockingReference && !scheduleLoaded && (
                        <span className="playlist-editor__version-locked">Delete unavailable</span>
                      )}
                      {busyKey === `delete:${v.versionId}` && <span>Deleting…</span>}
                      {busyKey === `restore:${v.versionId}` && <span>Restoring…</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
      {transaction ? (
        <QdnTransactionFlow
          title={transactionTitle}
          state={transaction}
          onClose={() => setTransaction(null)}
          onRetry={() => setTransaction(null)}
        />
      ) : null}
    </PageShell>
  );
}
