/* ============================================================
 * NodeFM Station — Admin Playlist Submissions Page
 *
 * Station-owner review surface for listener playlist submissions.
 * Preview resolves the exact submitted immutable listener version;
 * Accept forks that exact snapshot into station-owned playlist/version
 * resources and does not auto-schedule anything.
 * ============================================================ */

import { useState } from 'react';
import { PageShell } from '../../components/PageShell';
import { LoadingState } from '../../components/LoadingState';
import { ErrorState } from '../../components/ErrorState';
import { Modal } from '../../components/Modal';
import { QdnTransactionFlow } from '../../components/QdnTransactionFlow';
import {
  createQdnTransactionState,
  markQdnTransactionChunkActive,
  type QdnTransactionState,
} from '../../components/qdnTransactionFlow';
import { useStation } from '../../features/station';
import { usePlaylists } from '../../hooks/usePlaylists';
import { useLibrary } from '../../hooks/useLibrary';
import {
  useListenerPlaylistSubmissions,
  loadListenerPlaylistVersionDetail,
  type ListenerPlaylistSubmissionReview,
} from '../../features/listener-playlists';
import { formatDurationMs } from '../../utils/duration';
import { PaginationControls, paginateItems, usePagination } from '../../features/pagination';

type ActionState = {
  review: ListenerPlaylistSubmissionReview;
  type: 'accept' | 'reject';
};

export default function AdminPlaylistSubmissionsPage() {
  const { publisherName: stationPublisherName } = useStation();
  const { reviews, loaded, loading, incomplete, error, accept, reject, refresh } =
    useListenerPlaylistSubmissions();
  const { refresh: refreshPlaylists } = usePlaylists();
  const { refresh: refreshLibrary } = useLibrary();
  const [action, setAction] = useState<ActionState | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [preview, setPreview] = useState<Awaited<
    ReturnType<typeof loadListenerPlaylistVersionDetail>
  > | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [transaction, setTransaction] = useState<QdnTransactionState | null>(null);
  const pagination = usePagination(reviews.length);
  const pageReviews = paginateItems(reviews, pagination.pageIndex, pagination.pageSize);

  const openPreview = async (review: ListenerPlaylistSubmissionReview) => {
    if (!stationPublisherName) return;

    setPreviewLoading(true);
    setPreview(null);
    setActionError(null);

    try {
      setPreview(
        await loadListenerPlaylistVersionDetail(
          review.submission.listenerName,
          stationPublisherName,
          review.submission.playlistId,
          review.submission.versionId,
        ),
      );
    } catch (previewError) {
      setActionError(
        previewError instanceof Error ? previewError.message : 'Failed to preview playlist.',
      );
    } finally {
      setPreviewLoading(false);
    }
  };

  const closePreview = () => {
    if (previewLoading) return;
    setPreview(null);
  };

  const openAction = (review: ListenerPlaylistSubmissionReview, type: ActionState['type']) => {
    setAction({ review, type });
    setActionError(null);
    setRejectReason('');
  };

  const runAction = async () => {
    if (!action) return;

    setActionBusy(true);
    setActionError(null);
    setTransaction(
      createQdnTransactionState(
        [
          {
            id: 'moderation',
            label: `${action.type === 'accept' ? 'Accept' : 'Reject'} playlist submission`,
          },
        ],
        { retryable: true },
      ),
    );
    setTransaction((current) =>
      current ? markQdnTransactionChunkActive(current, 'moderation') : current,
    );

    try {
      if (action.type === 'accept') {
        await accept(action.review);
        await Promise.all([refreshPlaylists(), refreshLibrary()]);
      } else {
        await reject(action.review, rejectReason.trim() || undefined);
      }

      await refresh();
      setRejectReason('');
      setTransaction((current) =>
        current
          ? {
              ...current,
              chunks: current.chunks.map((item) => ({ ...item, status: 'succeeded' as const })),
              phase: 'success' as const,
              successMessage: `Playlist submission ${action.type === 'accept' ? 'accepted' : 'rejected'}.`,
              retryable: false,
            }
          : current,
      );
    } catch (actionFailure) {
      setActionError(
        actionFailure instanceof Error ? actionFailure.message : 'Moderation action failed.',
      );
      setTransaction((current) =>
        current
          ? {
              ...current,
              chunks: current.chunks.map((item) =>
                item.status === 'active' ? { ...item, status: 'failed' as const } : item,
              ),
              phase: 'failed' as const,
              error:
                actionFailure instanceof Error
                  ? actionFailure.message
                  : 'Moderation action failed.',
              retryable: true,
            }
          : current,
      );
    } finally {
      setActionBusy(false);
    }
  };

  if (loading && !loaded) {
    return (
      <PageShell title="Playlist Submissions">
        <LoadingState message="Loading playlist submissions…" />
      </PageShell>
    );
  }

  if (error && !loaded) {
    return (
      <PageShell title="Playlist Submissions">
        <ErrorState
          message="Failed to load playlist submissions."
          detail={error}
          onRetry={() => void refresh()}
        />
      </PageShell>
    );
  }

  return (
    <PageShell title="Playlist Submissions">
      <div className="listener-playlist-submissions">
        <div className="listener-uploads__header">
          <span className="admin-library__count">
            {reviews.length} submission{reviews.length !== 1 ? 's' : ''}
            {incomplete ? ' · partial discovery' : ''}
          </span>
          <button
            className="button button--secondary"
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
          >
            Refresh
          </button>
        </div>

        {error && loaded ? <p className="form-error">{error}</p> : null}

        {reviews.length === 0 ? (
          <p className="listener-uploads__empty">
            No listener playlists have been submitted for review yet.
          </p>
        ) : (
          <div className="listener-playlist-submissions__list">
            {pageReviews.map((review) => (
              <article
                key={`${review.metadata.publisherName}\u0000${review.metadata.identifier}`}
                className="submission-card"
              >
                <div className="submission-card__info">
                  <h3>{review.submission.playlistTitle}</h3>
                  <p>by {review.submission.listenerName}</p>
                  <p className="submission-card__meta">
                    Submitted {new Date(review.submission.submittedAt).toLocaleString()}
                  </p>
                  <span
                    className={`submission-card__status submission-card__status--${review.status.toLowerCase()}`}
                  >
                    {review.status}
                  </span>
                  {review.moderationError ? (
                    <span className="submission-card__warning">{review.moderationError}</span>
                  ) : null}
                </div>
                <div className="submission-card__actions">
                  <button
                    className="button button--secondary"
                    type="button"
                    onClick={() => void openPreview(review)}
                  >
                    Preview
                  </button>
                  {review.status === 'PENDING' ? (
                    <button
                      className="button button--primary"
                      type="button"
                      onClick={() => openAction(review, 'accept')}
                    >
                      Accept
                    </button>
                  ) : null}
                  {review.status === 'PENDING' ? (
                    <button
                      className="button button--secondary"
                      type="button"
                      onClick={() => openAction(review, 'reject')}
                    >
                      Reject
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}

        {reviews.length > 0 ? (
          <PaginationControls
            totalItems={reviews.length}
            pageIndex={pagination.pageIndex}
            pageSize={pagination.pageSize}
            onPageChange={pagination.setPageIndex}
            onPageSizeChange={pagination.setPageSize}
          />
        ) : null}

        {previewLoading ? (
          <Modal title="Preview" onClose={closePreview}>
            <LoadingState message="Loading exact submitted version…" />
          </Modal>
        ) : preview ? (
          <Modal title="Playlist Preview" onClose={closePreview}>
            <div className="listener-playlist-preview">
              {preview.status === 'ready' ? (
                <>
                  <h3>{preview.detail.playlist.title}</h3>
                  <p>{preview.detail.playlist.description}</p>
                  <p>
                    {preview.detail.version.tracks.length} tracks ·{' '}
                    {formatDurationMs(preview.detail.version.totalDurationMs)}
                  </p>
                  <ol>
                    {preview.detail.tracks.map((entry) => (
                      <li key={entry.track.trackId}>
                        {entry.track.title}
                        {entry.track.artist ? ` — ${entry.track.artist}` : ''}
                      </li>
                    ))}
                  </ol>
                </>
              ) : (
                <ErrorState message="Playlist version unavailable." detail={preview.message} />
              )}
            </div>
          </Modal>
        ) : null}

        {action ? (
          <Modal
            title={
              action.type === 'accept' ? 'Accept playlist submission' : 'Reject playlist submission'
            }
            onClose={() => {
              if (!actionBusy) setAction(null);
            }}
          >
            <div className="submission-review-modal">
              {transaction ? (
                <QdnTransactionFlow
                  title={
                    action.type === 'accept'
                      ? 'Accept playlist submission'
                      : 'Reject playlist submission'
                  }
                  state={transaction}
                  standalone={false}
                  onClose={() => {
                    setTransaction(null);
                    setAction(null);
                  }}
                  onRetry={() => void runAction()}
                />
              ) : (
                <>
                  <p>
                    <strong>{action.review.submission.playlistTitle}</strong>
                  </p>
                  <p>
                    Submitted by <strong>{action.review.submission.listenerName}</strong>
                  </p>
                  {action.type === 'accept' ? (
                    <p>
                      Accepting imports the exact submitted immutable version as a new station-owned
                      playlist. It will not be added to rotation or AutoDJ automatically.
                    </p>
                  ) : (
                    <label className="form-field">
                      Reason (optional)
                      <textarea
                        value={rejectReason}
                        onChange={(event) => setRejectReason(event.target.value)}
                        rows={3}
                        placeholder="Optional note for the station's audit record"
                      />
                    </label>
                  )}
                  {actionError ? <p className="form-error">{actionError}</p> : null}
                  <div className="form-actions">
                    <button
                      className="button button--secondary"
                      type="button"
                      onClick={() => setAction(null)}
                      disabled={actionBusy}
                    >
                      Cancel
                    </button>
                    <button
                      className="button button--primary"
                      type="button"
                      onClick={() => void runAction()}
                      disabled={actionBusy}
                    >
                      {actionBusy ? 'Saving…' : action.type === 'accept' ? 'Accept' : 'Reject'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </Modal>
        ) : null}
      </div>
    </PageShell>
  );
}
