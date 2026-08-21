/* ============================================================
 * NodeFM Station — Track Detail Modal
 *
 * Listener-facing reusable detail view. It is deliberately a
 * modal, not a page, so the listener remains in the current
 * listening/navigation context. Opening or closing it does not
 * touch the global AudioEngine.
 * ============================================================ */

import { Modal } from '../../../components/Modal';
import { TrackCover } from '../../library/components/TrackCover';
import type { Track } from '../../../types/domain';
import { getTrackDetailPresentation } from '../trackDetailPresentation';

type TrackDetailModalProps = {
  track: Track;
  onClose: () => void;
};

export function TrackDetailModal({ track, onClose }: TrackDetailModalProps) {
  const detail = getTrackDetailPresentation(track);
  const hasGenres = detail.genres.length > 0;
  const hasTags = detail.tags.length > 0;

  return (
    <Modal title="Track Details" onClose={onClose}>
      <div className="track-detail">
        <div className="track-detail__hero">
          <div className="track-detail__cover">
            <TrackCover
              cover={track.cover}
              placeholder={
                <div className="track-detail__cover-placeholder" aria-hidden="true">
                  <span className="signal-cover__core signal-cover__core--lg" />
                </div>
              }
              alt={`${detail.artist ? `${detail.artist} — ` : ''}${detail.title} cover`}
            />
          </div>

          <div className="track-detail__identity">
            <h3 className="track-detail__title">{detail.title}</h3>
            {detail.artist ? <p className="track-detail__artist">{detail.artist}</p> : null}
            {detail.description ? (
              <p className="track-detail__description">{detail.description}</p>
            ) : null}
          </div>
        </div>

        <dl className="track-detail__facts">
          <div className="track-detail__fact">
            <dt>Genres</dt>
            <dd>{hasGenres ? detail.genres.join(', ') : 'Not provided'}</dd>
          </div>
          <div className="track-detail__fact">
            <dt>Tags</dt>
            <dd>{hasTags ? detail.tags.join(' ') : 'Not provided'}</dd>
          </div>
          <div className="track-detail__fact">
            <dt>Duration</dt>
            <dd>{detail.duration}</dd>
          </div>
          <div className="track-detail__fact">
            <dt>Track source</dt>
            <dd>{detail.sourceLabel}</dd>
          </div>
          <div className="track-detail__fact">
            <dt>Audio publisher</dt>
            <dd>{detail.audioPublisher}</dd>
          </div>
        </dl>
      </div>
    </Modal>
  );
}
