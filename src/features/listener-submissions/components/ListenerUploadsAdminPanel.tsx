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
import { formatDurationMs } from '../../../utils/duration';
import { buildQdnUrl, openQdnAddress } from '../../../qortium/navigation';
import { TrackCover } from '../../library/components/TrackCover';
import { useLibrary } from '../../../hooks/useLibrary';
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
  };

  const runAction = async () => {
    if (!action) return;

    setActionBusy(true);
    setActionError(null);

    try {
      if (action.type === 'accept') {
        await accept(action.review);
        await refreshLibrary();
      } else {
        await reject(action.review, rejectReason.trim() || undefined);
      }

      await refresh();
      setAction(null);
      setRejectReason('');
    } catch (actionFailure) {
      setActionError(
        actionFailure instanceof Error ? actionFailure.message : 'Moderation action failed.',
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
          {diagnostics.length} discovered resource
          {diagnostics.length !== 1 ? 's' : ''} could not be included.
        </p>
      ) : null}

      {error && loaded ? <p className="form-error">{error}</p> : null}

      {reviews.length === 0 ? (
        <p className="listener-uploads__empty">No listener submissions have been published yet.</p>
      ) : (
        <div className="listener-uploads__list">
          {reviews.map((review) => (
            <SubmissionReviewCard
              key={`${review.metadata.publisherName}\u0000${review.metadata.identifier}`}
              review={review}
              onAccept={() => openAction(review, 'accept')}
              onReject={() => openAction(review, 'reject')}
            />
          ))}
        </div>
      )}

      {action ? (
        <Modal
          title={action.type === 'accept' ? 'Accept submission' : 'Reject submission'}
          onClose={closeAction}
        >
          <div className="submission-review-modal">
            <p>
              <strong>{action.review.submission.title}</strong>
              {action.review.submission.artist ? ` — ${action.review.submission.artist}` : ''}
            </p>
            <p>
              Submitted by <strong>{action.review.submission.submitterName}</strong>
            </p>

            {action.type === 'accept' ? (
              <p>
                Accepting this submission creates a normal Station Track whose audio continues to
                reference the listener&apos;s published AUDIO resource.
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
