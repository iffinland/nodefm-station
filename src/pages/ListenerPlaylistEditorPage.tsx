/* ============================================================
 * NodeFM Station — Listener Playlist Editor Page
 *
 * Listener-owned playlist draft editor. It reuses station library
 * track data for the canonical-track path, embeds the existing
 * Submit Music flow for pending submissions, and publishes immutable
 * listener PlaylistVersion resources only after every entry is
 * resolved to an approved Station Track.
 * ============================================================ */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PageShell } from '../components/PageShell';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { Modal } from '../components/Modal';
import { QdnTransactionFlow } from '../components/QdnTransactionFlow';
import {
  createQdnTransactionState,
  markQdnTransactionChunkActive,
  type QdnTransactionState,
} from '../components/qdnTransactionFlow';
import { useAuth } from '../app/providers/authContext';
import { useStation } from '../features/station';
import { useLibrary } from '../hooks/useLibrary';
import {
  TrackFilterBar,
  TrackMetadataLine,
  TrackPrimaryLine,
  useTrackFiltering,
} from '../features/tracks';
import {
  useListenerPlaylists,
  resolveListenerPlaylistSubmissions,
} from '../features/listener-playlists';
import { useListenerUploads } from '../features/listener-uploads';
import { submitListenerPlaylist } from '../features/listener-playlists/services/listenerPlaylistSubmissionStore';
import { SubmitMusicForm } from '../features/listener-submissions/components/SubmitMusicForm';
import { formatDurationMs } from '../utils/duration';
import { PaginationControls, paginateItems, usePagination } from '../features/pagination';
import type { ListenerTrackSubmission } from '../types/domain';
import {
  getListenerPlaylistDisplayTitle,
  type ListenerPlaylistDraft,
  type ListenerSubmissionResolution,
} from '../features/listener-playlists/services/listenerPlaylistService';

export default function ListenerPlaylistEditorPage() {
  const { playlistId = 'new' } = useParams<{ playlistId: string }>();
  const navigate = useNavigate();
  const { auth, ownerName } = useAuth();
  const { publisherName: stationPublisherName, station } = useStation();
  const { tracks: libraryTracks, loading: libraryLoading } = useLibrary();
  const trackFiltering = useTrackFiltering(libraryTracks);
  const trackFilteringPagination = usePagination(trackFiltering.visibleTracks.length);
  const {
    getDraft,
    getPlaylist,
    getLatestVersion,
    createDraft,
    saveDraft,
    addTracks,
    addOwnerTrack,
    removeEntry,
    reorderEntry,
    shuffleDraft,
    rotateDraft,
    editDraft,
    resolveEntries,
    evaluatePublication,
    evaluateStationSubmission,
    publishDraft,
    clearDraft,
  } = useListenerPlaylists();
  const {
    uploads,
    loaded: uploadsLoaded,
    loading: uploadsLoading,
    refresh: refreshUploads,
  } = useListenerUploads();

  const [draft, setDraft] = useState<ListenerPlaylistDraft | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [editingMeta, setEditingMeta] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editVisibility, setEditVisibility] = useState<'public' | 'private'>('private');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [transaction, setTransaction] = useState<QdnTransactionState | null>(null);
  const [activeSource, setActiveSource] = useState<
    'station-library' | 'my-uploads' | 'upload-music'
  >('station-library');
  const [uploadSearch, setUploadSearch] = useState('');
  const [selectedUploadIds, setSelectedUploadIds] = useState<Set<string>>(new Set());
  const [resolutions, setResolutions] = useState<ListenerSubmissionResolution[]>([]);
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(new Set());
  const [dragEntryId, setDragEntryId] = useState<string | null>(null);
  const uploadPagination = usePagination(
    uploads.filter((entry) =>
      `${entry.track.title} ${entry.track.artist ?? ''} ${entry.status}`
        .toLowerCase()
        .includes(uploadSearch.toLowerCase()),
    ).length,
  );

  const ownerAddress = auth.status === 'authenticated' ? auth.address : null;
  const identityKey = `${ownerName ?? ''}\u0000${ownerAddress ?? ''}\u0000${playlistId}`;

  useEffect(() => {
    setDraft(null);
    setInitialized(false);
    setEditingMeta(false);
    setEditVisibility('private');
    setError(null);
    setSuccess(null);
    setTransaction(null);
    setActiveSource('station-library');
    setUploadSearch('');
    setSelectedUploadIds(new Set());
    setResolutions([]);
    setSelectedTrackIds(new Set());
    setDragEntryId(null);
  }, [identityKey]);

  useEffect(() => {
    if (initialized || !ownerName || !ownerAddress) return;

    if (playlistId === 'new') {
      const nextDraft = createDraft({
        title: '',
        description: '',
        visibility: 'private',
      });
      setDraft(nextDraft);
      setEditTitle('');
      setEditDescription('');
      setEditVisibility('private');
      setInitialized(true);
      return;
    }

    const storedDraft = getDraft(playlistId);
    if (storedDraft) {
      setDraft(storedDraft);
      setEditTitle(storedDraft.title);
      setEditDescription(storedDraft.description ?? '');
      setEditVisibility(storedDraft.visibility ?? 'private');
      setInitialized(true);
      return;
    }

    const published = getPlaylist(playlistId);
    if (published) {
      const latest = getLatestVersion(playlistId);
      const entries = latest
        ? latest.tracks
            .map((track) => {
              const libraryTrack = libraryTracks.find(
                (candidate) => candidate.trackId === track.trackId,
              );
              if (!libraryTrack) return null;
              return {
                entryId: `${track.trackId}-${Date.now()}-${Math.random()}`,
                kind: 'canonical-track' as const,
                trackId: libraryTrack.trackId,
                durationMs: libraryTrack.durationMs,
                title: libraryTrack.title,
                artist: libraryTrack.artist,
              };
            })
            .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
        : [];

      const nextDraft: ListenerPlaylistDraft = {
        playlistId: published.playlistId,
        title: published.title,
        description: published.description,
        visibility: published.visibility,
        ownerName,
        ownerAddress,
        entries,
        createdAt: published.createdAt,
        updatedAt: new Date().toISOString(),
      };

      setDraft(nextDraft);
      saveDraft(nextDraft);
      setEditTitle(published.title);
      setEditDescription(published.description ?? '');
      setEditVisibility(published.visibility);
      setInitialized(true);
    }
  }, [
    createDraft,
    getDraft,
    getLatestVersion,
    getPlaylist,
    initialized,
    libraryTracks,
    ownerAddress,
    ownerName,
    playlistId,
    saveDraft,
  ]);

  useEffect(() => {
    if (!draft || !ownerName || !ownerAddress) return;

    let cancelled = false;
    resolveListenerPlaylistSubmissions(
      draft,
      stationPublisherName,
      station?.ownerAddress?.trim() || null,
    ).then((nextResolutions) => {
      if (!cancelled) setResolutions(nextResolutions);
    });

    return () => {
      cancelled = true;
    };
  }, [draft, ownerName, ownerAddress, stationPublisherName, station?.ownerAddress]);

  const resolvedEntries = useMemo(
    () => (draft ? resolveEntries(draft, resolutions) : []),
    [draft, resolutions, resolveEntries],
  );
  const publication = useMemo(
    () => (draft ? evaluatePublication(draft, resolutions) : null),
    [draft, resolutions, evaluatePublication],
  );
  const stationSubmission = useMemo(
    () => (draft ? evaluateStationSubmission(draft, resolutions) : null),
    [draft, resolutions, evaluateStationSubmission],
  );
  const playlistTitle = draft ? getListenerPlaylistDisplayTitle(draft) : '';

  const totalDurationMs = useMemo(
    () => (draft ? draft.entries.reduce((sum, entry) => sum + entry.durationMs, 0) : 0),
    [draft],
  );

  const filteredUploads = useMemo(
    () =>
      uploads.filter((entry) =>
        `${entry.track.title} ${entry.track.artist ?? ''} ${entry.status}`
          .toLowerCase()
          .includes(uploadSearch.toLowerCase()),
      ),
    [uploadSearch, uploads],
  );

  const updateDraft = useCallback(
    (nextDraft: ListenerPlaylistDraft) => {
      setDraft(nextDraft);
      saveDraft(nextDraft);
    },
    [saveDraft],
  );

  const handleSaveMeta = useCallback(() => {
    if (!draft) return;
    const next = editDraft(draft, {
      title: editTitle,
      description: editDescription || undefined,
      visibility: editVisibility,
    });
    setDraft(next);
    saveDraft(next);
    setEditingMeta(false);
  }, [draft, editDescription, editTitle, editVisibility, editDraft, saveDraft]);

  const handleAddTracks = useCallback(() => {
    if (!draft || selectedTrackIds.size === 0) return;
    const selected = libraryTracks.filter((track) => selectedTrackIds.has(track.trackId));
    const next = addTracks(draft, selected);
    setDraft(next);
    saveDraft(next);
    setSelectedTrackIds(new Set());
  }, [addTracks, draft, libraryTracks, saveDraft, selectedTrackIds]);

  const toggleTrackSelection = useCallback((trackId: string) => {
    setSelectedTrackIds((current) => {
      const next = new Set(current);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  }, []);

  const toggleUploadSelection = useCallback((trackId: string) => {
    setSelectedUploadIds((current) => {
      const next = new Set(current);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  }, []);

  const handleAddUploads = useCallback(() => {
    if (!draft || selectedUploadIds.size === 0) return;

    const selected = filteredUploads.filter((entry) => selectedUploadIds.has(entry.track.trackId));
    let next = draft;
    for (const entry of selected) {
      next = addOwnerTrack(next, {
        submissionId: entry.submission.submissionId,
        durationMs: entry.submission.durationMs,
        title: entry.submission.title,
        artist: entry.submission.artist,
      });
    }

    setDraft(next);
    saveDraft(next);
    setSelectedUploadIds(new Set());
  }, [addOwnerTrack, draft, filteredUploads, saveDraft, selectedUploadIds]);

  const handleUploadPublished = useCallback(
    async (submission: ListenerTrackSubmission) => {
      if (!draft) return;

      const next = addOwnerTrack(draft, {
        submissionId: submission.submissionId,
        durationMs: submission.durationMs,
        title: submission.title,
        artist: submission.artist,
      });
      setDraft(next);
      saveDraft(next);
      setActiveSource('my-uploads');
      setSuccess('Upload complete — Added to your playlist. Station review: Pending.');
      setUploadSearch('');

      await refreshUploads();
    },
    [addOwnerTrack, draft, refreshUploads, saveDraft],
  );

  const handlePublish = useCallback(async () => {
    if (!draft || !publication?.publishable || !ownerName || !ownerAddress) return;

    setBusy(true);
    setError(null);
    setSuccess(null);

    const latest = getLatestVersion(draft.playlistId);
    const hasExisting = Boolean(getPlaylist(draft.playlistId));
    const specs = hasExisting
      ? [
          { id: 'version', label: 'Publish immutable playlist version' },
          { id: 'pointer', label: 'Update playlist pointer' },
        ]
      : [
          { id: 'playlist', label: 'Publish logical playlist' },
          { id: 'version', label: 'Publish immutable playlist version' },
          { id: 'pointer', label: 'Update playlist pointer' },
        ];

    setTransaction(createQdnTransactionState(specs, { cancelable: false, retryable: true }));

    const result = await publishDraft(draft, publication.tracks, latest, (chunk) => {
      setTransaction((current) => {
        if (!current) return current;

        if (chunk === 'prepare') {
          return current;
        }

        const mappedChunk = chunk;
        return markQdnTransactionChunkActive(current, mappedChunk);
      });
    });

    if (result.ok) {
      clearDraft(draft.playlistId);
      setTransaction((current) => {
        if (!current) return current;
        const chunks = current.chunks.map((item) => ({
          ...item,
          status: 'succeeded' as const,
        }));
        return {
          ...current,
          chunks,
          phase: 'success' as const,
          successMessage: `Published version ${result.version.versionNumber}.`,
          retryable: false,
        };
      });
    } else {
      setTransaction((current) => {
        if (!current) return current;
        const chunks = current.chunks.map((item) =>
          item.status === 'active' ? { ...item, status: 'failed' as const } : item,
        );
        return {
          ...current,
          chunks,
          phase: 'failed' as const,
          error: result.error,
          retryable: true,
        };
      });
    }

    setBusy(false);
  }, [
    clearDraft,
    draft,
    getLatestVersion,
    getPlaylist,
    ownerAddress,
    ownerName,
    publication,
    publishDraft,
  ]);

  const handleSubmitToStation = useCallback(async () => {
    if (!draft || !ownerName || !ownerAddress || !stationSubmission?.eligible) return;
    const latest = getLatestVersion(draft.playlistId);
    if (!latest) return;

    setBusy(true);
    setError(null);
    setSuccess(null);

    try {
      await submitListenerPlaylist({
        listenerName: ownerName,
        listenerAddress: ownerAddress,
        playlistId: draft.playlistId,
        playlistTitle: getListenerPlaylistDisplayTitle(draft),
        versionId: latest.versionId,
      });
      setSuccess('Playlist submitted to the station for review.');
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'Failed to submit playlist to station.',
      );
    } finally {
      setBusy(false);
    }
  }, [draft, getLatestVersion, ownerAddress, ownerName, stationSubmission?.eligible]);

  if (auth.status === 'loading') {
    return (
      <PageShell title="Listener Playlist Editor">
        <LoadingState message="Loading playlist editor…" />
      </PageShell>
    );
  }

  if (!ownerName || !ownerAddress) {
    return (
      <PageShell title="Listener Playlist Editor">
        <ErrorState
          message="Registered Name required"
          detail="A registered QDN name is required to create and publish playlists."
        />
      </PageShell>
    );
  }

  if (!initialized || (libraryLoading ?? false)) {
    return (
      <PageShell title="Listener Playlist Editor">
        <LoadingState message="Loading playlist editor…" />
      </PageShell>
    );
  }

  if (!draft) {
    return (
      <PageShell title="Listener Playlist Editor">
        <ErrorState message="Playlist not found." onRetry={() => navigate('/my-playlists')} />
      </PageShell>
    );
  }

  const addPanelPageTracks = paginateItems(
    trackFiltering.visibleTracks,
    trackFilteringPagination.pageIndex,
    trackFilteringPagination.pageSize,
  );
  const uploadPageItems = paginateItems(
    filteredUploads,
    uploadPagination.pageIndex,
    uploadPagination.pageSize,
  );

  return (
    <PageShell title={draft.title || 'New Listener Playlist'}>
      <div className="playlist-editor listener-playlist-editor">
        <div className="playlist-editor__header">
          {editingMeta ? (
            <div className="playlist-editor__meta-form">
              <label className="form-field">
                Title
                <input
                  type="text"
                  value={editTitle}
                  onChange={(event) => setEditTitle(event.target.value)}
                />
              </label>
              <label className="form-field">
                Description
                <textarea
                  value={editDescription}
                  onChange={(event) => setEditDescription(event.target.value)}
                  rows={2}
                />
              </label>
              <label className="form-field">
                Visibility
                <select
                  value={editVisibility}
                  onChange={(event) =>
                    setEditVisibility(event.target.value as 'public' | 'private')
                  }
                >
                  <option value="private">Private — only visible to me</option>
                  <option value="public">Public — visible on Playlists</option>
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
                  disabled={!editTitle.trim()}
                >
                  Save
                </button>
              </div>
            </div>
          ) : (
            <div className="playlist-editor__meta-display">
              <div>
                <h2>{playlistTitle}</h2>
                {draft.description && <p>{draft.description}</p>}
                <span
                  className={`playlist-editor__visibility playlist-editor__visibility--${draft.visibility ?? 'private'}`}
                >
                  {draft.visibility ?? 'private'}
                </span>
                <span className="playlist-editor__version-info">
                  {draft.entries.length} track{draft.entries.length === 1 ? '' : 's'} ·{' '}
                  {formatDurationMs(totalDurationMs)}
                </span>
              </div>
              <div className="playlist-editor__header-actions">
                <button
                  className="button button--secondary"
                  type="button"
                  onClick={() => setEditingMeta(true)}
                >
                  Edit Info
                </button>
              </div>
            </div>
          )}
        </div>

        {error && <p className="form-error">{error}</p>}
        {success && <p className="form-success">{success}</p>}

        <div className="playlist-editor__stats">
          <span>{draft.entries.length} tracks</span>
          <span>Total: {formatDurationMs(totalDurationMs)}</span>
          {publication && !publication.publishable && (
            <span className="playlist-editor__stats-warning">{publication.reason}</span>
          )}
        </div>

        <div className="playlist-editor__source-tabs" role="tablist" aria-label="Track sources">
          <button
            className={`button ${activeSource === 'station-library' ? 'button--primary' : 'button--secondary'}`}
            type="button"
            onClick={() => setActiveSource('station-library')}
          >
            Station Library
          </button>
          <button
            className={`button ${activeSource === 'my-uploads' ? 'button--primary' : 'button--secondary'}`}
            type="button"
            onClick={() => setActiveSource('my-uploads')}
          >
            My Uploads
          </button>
          <button
            className={`button ${activeSource === 'upload-music' ? 'button--primary' : 'button--secondary'}`}
            type="button"
            onClick={() => setActiveSource('upload-music')}
          >
            Upload New Music
          </button>
        </div>

        <div className="playlist-editor__actions">
          <button
            className="button button--secondary"
            type="button"
            onClick={() => {
              if (draft) updateDraft(shuffleDraft(draft));
            }}
          >
            Shuffle
          </button>
          <button
            className="button button--secondary"
            type="button"
            onClick={() => {
              if (draft) updateDraft(rotateDraft(draft));
            }}
          >
            Rotate Start
          </button>
          <button
            className="button button--primary"
            type="button"
            onClick={handlePublish}
            disabled={busy || !publication?.publishable}
          >
            {busy ? 'Publishing…' : 'Publish Playlist'}
          </button>
        </div>

        {activeSource === 'station-library' && (
          <div className="playlist-editor__add-panel">
            <h3>Station Library Tracks</h3>
            {libraryTracks.length === 0 ? (
              <p>No tracks in station library. Submit new music or wait for library content.</p>
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
                  <>
                    <div className="playlist-editor__selection-toolbar">
                      <span>{selectedTrackIds.size} selected</span>
                      <button
                        className="button button--secondary"
                        type="button"
                        onClick={() => setSelectedTrackIds(new Set())}
                        disabled={selectedTrackIds.size === 0}
                      >
                        Clear selected
                      </button>
                      <button
                        className="button button--primary"
                        type="button"
                        onClick={handleAddTracks}
                        disabled={selectedTrackIds.size === 0}
                      >
                        Add {selectedTrackIds.size} Track{selectedTrackIds.size === 1 ? '' : 's'}
                      </button>
                    </div>
                    <div className="playlist-editor__library-list">
                      {addPanelPageTracks.map((track) => {
                        const alreadyAdded = draft.entries.some(
                          (entry) =>
                            entry.kind === 'canonical-track' && entry.trackId === track.trackId,
                        );
                        const checked = selectedTrackIds.has(track.trackId);

                        return (
                          <div key={track.trackId} className="playlist-editor__library-item">
                            <label className="playlist-editor__library-checkbox">
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={alreadyAdded}
                                onChange={() => toggleTrackSelection(track.trackId)}
                              />
                            </label>
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
                            <span className="playlist-editor__library-item-added">
                              {alreadyAdded ? 'Added' : checked ? 'Selected' : ''}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <PaginationControls
                      totalItems={trackFiltering.visibleTracks.length}
                      pageIndex={trackFilteringPagination.pageIndex}
                      pageSize={trackFilteringPagination.pageSize}
                      onPageChange={trackFilteringPagination.setPageIndex}
                      onPageSizeChange={trackFilteringPagination.setPageSize}
                    />
                  </>
                )}
              </>
            )}
          </div>
        )}

        {activeSource === 'my-uploads' && (
          <div className="playlist-editor__add-panel">
            <h3>My Uploads</h3>
            {uploadsLoading && !uploadsLoaded ? (
              <LoadingState message="Loading your uploads…" />
            ) : filteredUploads.length === 0 ? (
              <p className="playlist-editor__empty">
                No uploads yet. Use Upload New Music to publish your first listener-owned Track.
              </p>
            ) : (
              <>
                <input
                  className="playlist-editor__upload-search"
                  type="search"
                  placeholder="Search your uploads"
                  value={uploadSearch}
                  onChange={(event) => setUploadSearch(event.target.value)}
                />
                <div className="playlist-editor__selection-toolbar">
                  <span>{selectedUploadIds.size} selected</span>
                  <button
                    className="button button--secondary"
                    type="button"
                    onClick={() => setSelectedUploadIds(new Set())}
                    disabled={selectedUploadIds.size === 0}
                  >
                    Clear selected
                  </button>
                  <button
                    className="button button--primary"
                    type="button"
                    onClick={handleAddUploads}
                    disabled={selectedUploadIds.size === 0}
                  >
                    Add {selectedUploadIds.size} Track
                    {selectedUploadIds.size === 1 ? '' : 's'}
                  </button>
                </div>
                <div className="playlist-editor__library-list">
                  {uploadPageItems.map((entry) => {
                    const alreadyAdded = draft.entries.some(
                      (draftEntry) =>
                        draftEntry.kind === 'pending-submission' &&
                        draftEntry.submissionId === entry.submission.submissionId,
                    );
                    const checked = selectedUploadIds.has(entry.track.trackId);

                    return (
                      <div
                        key={entry.submission.submissionId}
                        className="playlist-editor__library-item"
                      >
                        <label className="playlist-editor__library-checkbox">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={alreadyAdded}
                            onChange={() => toggleUploadSelection(entry.track.trackId)}
                          />
                        </label>
                        <div className="playlist-editor__library-item-main">
                          <TrackPrimaryLine
                            track={entry.track}
                            className="playlist-editor__library-item-title"
                          />
                          <TrackMetadataLine
                            track={entry.track}
                            className="playlist-editor__library-item-taxonomy"
                          />
                          <span
                            className={`submission-card__status submission-card__status--${entry.status.toLowerCase()}`}
                          >
                            Station: {entry.status}
                          </span>
                        </div>
                        <span className="playlist-editor__library-item-duration">
                          {formatDurationMs(entry.track.durationMs)}
                        </span>
                        <span className="playlist-editor__library-item-added">
                          {alreadyAdded ? 'Added' : checked ? 'Selected' : ''}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <PaginationControls
                  totalItems={filteredUploads.length}
                  pageIndex={uploadPagination.pageIndex}
                  pageSize={uploadPagination.pageSize}
                  onPageChange={uploadPagination.setPageIndex}
                  onPageSizeChange={uploadPagination.setPageSize}
                />
              </>
            )}
          </div>
        )}

        <div className="playlist-editor__track-list">
          {resolvedEntries.length === 0 ? (
            <p className="playlist-editor__empty">
              No tracks in this playlist yet. Add from the station library or submit new music.
            </p>
          ) : (
            resolvedEntries.map((entry, index) => {
              const title =
                entry.kind === 'canonical-track'
                  ? `${entry.title}${entry.artist ? ` — ${entry.artist}` : ''}`
                  : `${entry.title}${entry.artist ? ` — ${entry.artist}` : ''}`;
              const statusLabel =
                entry.kind === 'canonical-track'
                  ? 'Ready'
                  : entry.stationStatus === 'ACCEPTED'
                    ? 'Station: Approved'
                    : entry.stationStatus === 'REJECTED'
                      ? 'Station: Not approved'
                      : entry.stationStatus === 'UNRESOLVED'
                        ? 'Station: Unavailable'
                        : 'Station: Pending';

              return (
                <div
                  key={entry.entryId}
                  className={`playlist-editor__track-item ${dragEntryId === entry.entryId ? 'playlist-editor__track-item--dragging' : ''}`}
                  draggable
                  onDragStart={() => setDragEntryId(entry.entryId)}
                  onDragOver={(event) => {
                    event.preventDefault();
                    if (!draft || !dragEntryId || dragEntryId === entry.entryId) return;
                    const next = reorderEntry(draft, dragEntryId, index);
                    setDraft(next);
                    saveDraft(next);
                    setDragEntryId(entry.entryId);
                  }}
                  onDragEnd={() => setDragEntryId(null)}
                >
                  <span className="playlist-editor__drag-handle" aria-hidden="true">
                    ⠿
                  </span>
                  <span className="playlist-editor__track-num">{index + 1}</span>
                  <div className="playlist-editor__track-info">
                    <strong>{title}</strong>
                    <span
                      className={`listener-playlist-entry-status listener-playlist-entry-status--${statusLabel.toLowerCase()}`}
                    >
                      {statusLabel}
                    </span>
                  </div>
                  <span className="playlist-editor__track-duration">
                    {formatDurationMs(entry.durationMs)}
                  </span>
                  <button
                    className="button button--secondary playlist-editor__remove-btn"
                    type="button"
                    onClick={() => {
                      if (draft) updateDraft(removeEntry(draft, entry.entryId));
                    }}
                    title="Remove from playlist"
                  >
                    ✕
                  </button>
                </div>
              );
            })
          )}
        </div>

        {getLatestVersion(draft.playlistId) && (
          <div className="playlist-editor__published-actions">
            <h3>Published Version</h3>
            <p>v{getLatestVersion(draft.playlistId)?.versionNumber}</p>
            <Link className="button button--primary" to={`/my-playlists/${draft.playlistId}/play`}>
              Play
            </Link>
            <button
              className="button button--secondary"
              type="button"
              onClick={handleSubmitToStation}
              disabled={busy || !stationSubmission?.eligible}
            >
              Submit to Station
            </button>
            {stationSubmission && !stationSubmission.eligible ? (
              <span className="playlist-editor__stats-warning">{stationSubmission.reason}</span>
            ) : null}
          </div>
        )}
      </div>

      {activeSource === 'upload-music' && (
        <Modal title="Upload New Music" onClose={() => setActiveSource('my-uploads')}>
          <SubmitMusicForm onPublished={handleUploadPublished} embedded />
        </Modal>
      )}

      {transaction ? (
        <QdnTransactionFlow
          title="Publish Playlist"
          state={transaction}
          onClose={() => setTransaction(null)}
          onRetry={() => {
            setTransaction(null);
            void handlePublish();
          }}
        />
      ) : null}
    </PageShell>
  );
}
