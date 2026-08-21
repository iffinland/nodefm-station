/* ============================================================
 * NodeFM Station — Library Page (Admin)
 *
 * Full music library management UI.
 * Phase 2: upload, add QDN, edit, delete, status display.
 * ============================================================ */

import { useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';
import { LoadingState } from '../../components/LoadingState';
import { ErrorState } from '../../components/ErrorState';
import { Modal } from '../../components/Modal';
import { useLibrary } from '../../hooks/useLibrary';
import { useStationIdentity } from '../../features/station';
import { formatDurationMs } from '../../utils/duration';
import type { Track } from '../../types/domain';
import { TrackEditModal } from '../../features/library/components/TrackEditModal';
import { UploadFlow } from '../../features/library/components/UploadFlow';
import { AddQdnFlow } from '../../features/library/components/AddQdnFlow';
import { TrackCover } from '../../features/library/components/TrackCover';
import { ListenerUploadsAdminPanel } from '../../features/listener-submissions/components/ListenerUploadsAdminPanel';
import { BulkImportWorkspace } from '../../features/bulk-import';
import {
  TrackFilterBar,
  TrackMetadataLine,
  TrackPrimaryLine,
  useTrackFiltering,
} from '../../features/tracks';

type LibraryTab = 'library' | 'uploads';

export default function LibraryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const libraryAction = searchParams.get('action');
  const { tracks, loaded, loading, error, incomplete, diagnostics, removeTrack, refresh } =
    useLibrary();
  const trackFiltering = useTrackFiltering(tracks);
  const [activeTab, setActiveTab] = useState<LibraryTab>('library');
  const [showUpload, setShowUpload] = useState(false);
  const [showAddQdn, setShowAddQdn] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [editingTrack, setEditingTrack] = useState<Track | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const { ownerAddress, publisherName } = useStationIdentity();
  const bulkScope = ownerAddress ?? publisherName ?? '';

  useEffect(() => {
    if (libraryAction === 'upload') {
      setShowUpload(true);
      setShowAddQdn(false);
    } else if (libraryAction === 'add-qdn') {
      setShowAddQdn(true);
      setShowUpload(false);
    }
  }, [libraryAction]);

  const clearLibraryAction = useCallback(() => {
    if (searchParams.has('action')) {
      const next = new URLSearchParams(searchParams);
      next.delete('action');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const handleUploadComplete = useCallback(() => {
    setShowUpload(false);
    clearLibraryAction();
  }, [clearLibraryAction]);

  const handleUploadClose = useCallback(() => {
    setShowUpload(false);
    clearLibraryAction();
  }, [clearLibraryAction]);

  const handleAddQdnClose = useCallback(() => {
    setShowAddQdn(false);
    clearLibraryAction();
  }, [clearLibraryAction]);

  const handleAddQdnComplete = useCallback(() => {
    setShowAddQdn(false);
    clearLibraryAction();
  }, [clearLibraryAction]);

  const handleDeleteTrack = useCallback(
    async (trackId: string, title: string) => {
      if (
        window.confirm(
          `Remove "${title}" from the library? This tombstones the track metadata. The audio/cover QDN resources are left intact.`,
        )
      ) {
        setRemoveError(null);
        try {
          await removeTrack(trackId);
        } catch (err) {
          setRemoveError(err instanceof Error ? err.message : 'Failed to remove track.');
        }
      }
    },
    [removeTrack],
  );

  if (loading && !loaded) {
    return (
      <PageShell title="Library">
        <LoadingState message="Loading library…" />
      </PageShell>
    );
  }

  if (error && !loaded) {
    return (
      <PageShell title="Library">
        <ErrorState message="Failed to load library." detail={error} onRetry={refresh} />
      </PageShell>
    );
  }

  return (
    <PageShell title="Library">
      <div className="admin-library">
        <div className="admin-library__tabs" role="tablist" aria-label="Library sections">
          <button
            className={`button ${activeTab === 'library' ? 'button--primary' : 'button--secondary'}`}
            type="button"
            role="tab"
            aria-selected={activeTab === 'library'}
            onClick={() => setActiveTab('library')}
          >
            Station Library
          </button>
          <button
            className={`button ${activeTab === 'uploads' ? 'button--primary' : 'button--secondary'}`}
            type="button"
            role="tab"
            aria-selected={activeTab === 'uploads'}
            onClick={() => setActiveTab('uploads')}
          >
            Listener Uploads
          </button>
        </div>

        {activeTab === 'uploads' ? (
          <ListenerUploadsAdminPanel />
        ) : (
          <>
            {removeError && <p className="form-error">{removeError}</p>}
            {incomplete && (
              <div className="form-error">
                Library reconstruction is incomplete ({diagnostics.length} unavailable or malformed
                resource{diagnostics.length === 1 ? '' : 's'}).{' '}
                <button className="button button--secondary" type="button" onClick={refresh}>
                  Retry
                </button>
              </div>
            )}
            <div className="admin-library__toolbar">
              <button
                className="button button--primary"
                type="button"
                onClick={() => setShowUpload(true)}
              >
                Upload Audio
              </button>
              <button
                className="button button--secondary"
                type="button"
                onClick={() => setShowAddQdn(true)}
              >
                Add from QDN
              </button>
              <button
                className="button button--secondary"
                type="button"
                onClick={() => setShowBulkImport(true)}
              >
                Bulk Import
              </button>
            </div>

            {tracks.length > 0 ? (
              <TrackFilterBar
                filters={trackFiltering.filters}
                sort={trackFiltering.sort}
                options={trackFiltering.options}
                resultCount={trackFiltering.visibleTracks.length}
                totalCount={tracks.length}
                onFilterChange={trackFiltering.setFilter}
                onSortChange={trackFiltering.setSort}
                onClearFilters={trackFiltering.clearFilters}
              />
            ) : null}

            {tracks.length === 0 && incomplete ? (
              <p className="admin-library__empty">
                The station library could not be fully loaded. Retry before treating this as an
                empty library.
              </p>
            ) : tracks.length === 0 ? (
              <p className="admin-library__empty">
                No tracks in the library yet. Upload audio or add existing QDN resources to get
                started.
              </p>
            ) : trackFiltering.visibleTracks.length === 0 ? (
              <p className="admin-library__empty">No tracks match the current search or filters.</p>
            ) : (
              <div className="admin-library__grid">
                {trackFiltering.visibleTracks.map((track) => (
                  <TrackCard
                    key={track.trackId}
                    track={track}
                    onEdit={() => setEditingTrack(track)}
                    onDelete={() => handleDeleteTrack(track.trackId, track.title)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {showUpload && <UploadFlow onClose={handleUploadClose} onComplete={handleUploadComplete} />}

      {showAddQdn && <AddQdnFlow onClose={handleAddQdnClose} onComplete={handleAddQdnComplete} />}

      {showBulkImport && (
        <Modal title="Bulk Import" onClose={() => setShowBulkImport(false)} wide>
          <BulkImportWorkspace role="admin" scope={bulkScope} showHeader={false} />
        </Modal>
      )}

      {editingTrack && (
        <TrackEditModal track={editingTrack} onClose={() => setEditingTrack(null)} />
      )}
    </PageShell>
  );
}

function TrackCard({
  track,
  onEdit,
  onDelete,
}: {
  track: Track;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const hasValidDuration = track.durationMs > 0 && Number.isFinite(track.durationMs);

  return (
    <div className="track-card">
      <div className="track-card__cover">
        <TrackCover
          cover={track.cover}
          placeholder={<div className="track-card__cover-placeholder">🎵</div>}
        />
      </div>

      <div className="track-card__info">
        <h3 className="track-card__title">
          <TrackPrimaryLine track={track} />
        </h3>
        <TrackMetadataLine track={track} className="track-card__taxonomy" />
        <p className="track-card__duration">{formatDurationMs(track.durationMs)}</p>
        <div className="track-card__meta">
          <span className={`track-card__source track-card__source--${track.source}`}>
            {track.source === 'station-upload' ? 'Uploaded' : 'QDN'}
          </span>
          <span
            className={`track-card__eligibility ${hasValidDuration ? 'track-card__eligibility--ok' : 'track-card__eligibility--bad'}`}
          >
            {hasValidDuration ? 'Schedule Ready' : 'No Duration'}
          </span>
        </div>
      </div>

      <div className="track-card__actions">
        <button className="button button--secondary" type="button" onClick={onEdit}>
          Edit
        </button>
        <button className="button button--secondary" type="button" onClick={onDelete}>
          Remove
        </button>
      </div>
    </div>
  );
}
