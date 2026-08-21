/* ============================================================
 * NodeFM Station — Reusable Track Presentation Components
 *
 * Primary line:
 *   Artist — Title
 *
 * Secondary muted line:
 *   Genre   #tag1 #tag2
 * ============================================================ */

import type { Track } from '../../../types/domain';
import { getTrackMetadataLineParts, getTrackPrimaryLabel } from '../trackPresentation';

type TrackPrimaryLineProps = {
  track: Pick<Track, 'artist' | 'title'>;
  className?: string;
};

type TrackMetadataLineProps = {
  track: Pick<Track, 'genres' | 'tags'>;
  className?: string;
};

export function TrackPrimaryLine({ track, className }: TrackPrimaryLineProps) {
  return <span className={className}>{getTrackPrimaryLabel(track)}</span>;
}

export function TrackMetadataLine({ track, className }: TrackMetadataLineProps) {
  const parts = getTrackMetadataLineParts(track);
  const hasMetadata = parts.genres.length > 0 || parts.tags.length > 0;

  if (!hasMetadata) {
    return null;
  }

  const resolvedClassName = ['track-metadata-line', className].filter(Boolean).join(' ');

  return (
    <span className={resolvedClassName}>
      {parts.genres.length > 0 ? (
        <span className="track-metadata-line__genres">{parts.genres.join(', ')}</span>
      ) : null}
      {parts.tags.length > 0 ? (
        <span className="track-metadata-line__tags">{parts.tags.join(' ')}</span>
      ) : null}
    </span>
  );
}
