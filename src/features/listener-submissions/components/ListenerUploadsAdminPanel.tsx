/* ============================================================
 * NodeFM Station — Listener Uploads Admin Panel
 *
 * Station-owner review surface for pending/accepted/rejected listener
 * submissions. Moderation authority is enforced by the store, not only
 * by hiding buttons. Audio preview opens through Qortium Home navigation
 * and does not touch the global live/playlist AudioEngine.
 * ============================================================ */

import { useState } from 'react';
import { LoadingState } from '../../../components/LoadingState';
import { ErrorState } from '../../../components/ErrorState';
import { Modal } from '../../../components/Modal';
import { QdnTransactionFlow } from '../../../components/QdnTransactionFlow';
import {
  createQdnTransactionState,
  markQdnTransactionChunkActive,
  type QdnTransactionState,
} from '../../../components/qdnTransactionFlow';
import { formatDurationMs } from '../../../utils/duration';
import { buildQdnUrl, openQdnAddress } from '../../../qortium/navigation';
import { TrackCover } from '../../library/components/TrackCover';
import { useLibrary } from '../../../hooks/useLibrary';
import { PaginationControls, paginateItems, usePagination } from '../../pagination';
import type { ListenerSubmissionReview } from '../services/submissionStore';
import { useListenerSubmissions } from '../useListenerSubmissions';

type ActionState = {
  review: ListenerSubmissionReview;
  type: 'accept' | 'reject';
};

export function ListenerUploadsAdminPanel() {
  const { reviews, diagnostics, loaded, loading, incomplete, error, accept, reject, refresh } =
    useListenerSubmissions();
  const { refresh: refreshLibrary } = useLibrary();
  const [action, setAction] = useState<ActionState | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [transaction, setTransaction] = useState<QdnTransactionState | null>(null);
  const pagination = usePagination(reviews.length);
  const pageReviews = paginateItems(reviews, pagination.pageIndex, pagination.pageSize);

  const openAction = (review: ListenerSubmissionReview, type: ActionState['type']) => {
    setAction({ review, type });
    setActionError(null);
    setRejectReason('');
  };

  const closeAction = () => {
    if (actionBusy) return;
    setAction(null);
    setActionError(null);
    setRejectReason('');
    setTransaction(null);
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
            label: `${action.type === 'accept' ? 'Accept' : 'Reject'} listener upload`,
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
        await refreshLibrary();
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
              successMessage: `Submission ${action.type === 'accept' ? 'accepted' : 'rejected'}.`,
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
    return <LoadingState message="Loading listener uploads…" />;
  }

  if (error && !loaded) {
    return (
      <ErrorState
        message="Failed to load listener uploads."
        detail={error}
        onRetry={() => {
          void refresh();
        }}
      />
    );
  }

  return (
    <div className="listener-uploads">
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

      {incomplete && diagnostics.length > 0 ? (
        <p className="listener-uploads__warning">
          {diagnostics.length} listener submission
          {diagnostics.length !== 1 ? 's' : ''} could not be fully resolved.
        </p>
      ) : null}

      {error && loaded ? <p className="form-error">{error}</p> : null}

      {reviews.length === 0 ? (
        <p className="listener-uploads__empty">No listener submissions have been published yet.</p>
      ) : (
        <div className="listener-uploads__list">
          {pageReviews.map((review) => (
            <SubmissionReviewCard
              key={`${review.metadata.publisherName}\u0000${review.metadata.identifier}`}
              review={review}
              onAccept={() => openAction(review, 'accept')}
              onReject={() => openAction(review, 'reject')}
            />
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

      {action ? (
        <Modal
          title={action.type === 'accept' ? 'Accept submission' : 'Reject submission'}
          onClose={closeAction}
        >
          <div className="submission-review-modal">
            {transaction ? (
              <QdnTransactionFlow
                title={action.type === 'accept' ? 'Accept submission' : 'Reject submission'}
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
                  <strong>{action.review.submission.title}</strong>
                  {action.review.submission.artist ? ` — ${action.review.submission.artist}` : ''}
                </p>
                <p>
                  Submitted by <strong>{action.review.submission.submitterName}</strong>
                </p>

                {action.type === 'accept' ? (
                  <p>
                    Accepting this submission creates a normal Station Track whose audio continues
                    to reference the listener&apos;s published AUDIO resource.
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
                  <button className="button button--secondary" type="button" onClick={closeAction}>
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
  );
}

function SubmissionReviewCard({
  review,
  onAccept,
  onReject,
}: {
  review: ListenerSubmissionReview;
  onAccept: () => void;
  onReject: () => void;
}) {
  const submission = review.submission;

  return (
    <article className="submission-card">
      <div className="submission-card__cover">
        <TrackCover
          cover={submission.cover}
          placeholder={<div className="submission-card__cover-placeholder">🎵</div>}
          alt={`${submission.title} cover`}
        />
      </div>

      <div className="submission-card__info">
        <h3 className="submission-card__title">{submission.title}</h3>
        {submission.artist ? <p className="submission-card__artist">{submission.artist}</p> : null}
        <p className="submission-card__meta">
          {formatDurationMs(submission.durationMs)} · {submission.submitterName}
        </p>
        <p className="submission-card__meta">{new Date(submission.submittedAt).toLocaleString()}</p>
        {submission.description ? (
          <p className="submission-card__description">{submission.description}</p>
        ) : null}
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
          onClick={() => {
            void openQdnAddress(buildQdnUrl(submission.audio), 'new');
          }}
        >
          Open Audio
        </button>
        {review.status === 'PENDING' ? (
          <button className="button button--primary" type="button" onClick={onAccept}>
            Accept
          </button>
        ) : null}
        {review.status === 'PENDING' ? (
          <button className="button button--secondary" type="button" onClick={onReject}>
            Reject
          </button>
        ) : null}
      </div>
    </article>
  );
}
