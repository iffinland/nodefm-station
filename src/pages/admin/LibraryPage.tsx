/* ============================================================
 * NodeFM Station — Library Page (Admin)
 *
 * Full music library management UI.
 * Phase 2: upload, add QDN, edit, delete, status display.
 * ============================================================ */

import { useState, useCallback } from 'react';
import { PageShell } from '../../components/PageShell';
import { LoadingState } from '../../components/LoadingState';
import { ErrorState } from '../../components/ErrorState';
import { useLibrary } from '../../hooks/useLibrary';
import { formatDurationMs } from '../../utils/duration';
import type { Track } from '../../types/domain';
import { TrackEditModal } from '../../features/library/components/TrackEditModal';
import { UploadFlow } from '../../features/library/components/UploadFlow';
import { AddQdnFlow } from '../../features/library/components/AddQdnFlow';
import { TrackCover } from '../../features/library/components/TrackCover';

export default function LibraryPage() {
  const { tracks, loaded, loading, error, removeTrack, refresh } = useLibrary();
  const [showUpload, setShowUpload] = useState(false);
  const [showAddQdn, setShowAddQdn] = useState(false);
  const [editingTrack, setEditingTrack] = useState<Track | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const handleUploadComplete = useCallback(() => {
    setShowUpload(false);
  }, []);

  const handleAddQdnComplete = useCallback(() => {
    setShowAddQdn(false);
  }, []);

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
        {removeError && <p className="form-error">{removeError}</p>}
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
          <span className="admin-library__count">
            {tracks.length} track{tracks.length !== 1 ? 's' : ''}
          </span>
        </div>

        {tracks.length === 0 ? (
          <p className="admin-library__empty">
            No tracks in the library yet. Upload audio or add existing QDN resources to get started.
          </p>
        ) : (
          <div className="admin-library__grid">
            {tracks.map((track) => (
              <TrackCard
                key={track.trackId}
                track={track}
                onEdit={() => setEditingTrack(track)}
                onDelete={() => handleDeleteTrack(track.trackId, track.title)}
              />
            ))}
          </div>
        )}
      </div>

      {showUpload && (
        <UploadFlow onClose={() => setShowUpload(false)} onComplete={handleUploadComplete} />
      )}

      {showAddQdn && (
        <AddQdnFlow onClose={() => setShowAddQdn(false)} onComplete={handleAddQdnComplete} />
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
        <h3 className="track-card__title">{track.title}</h3>
        {track.artist && <p className="track-card__artist">{track.artist}</p>}
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
