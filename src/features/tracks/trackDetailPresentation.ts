/* ============================================================
 * NodeFM Station — Track Detail Presentation Helpers
 *
 * Pure metadata formatting for the reusable Track Detail modal.
 * It exposes only information already present in the Track model;
 * no encyclopedia facts are invented and no QDN fields are
 * surfaced as if they were ordinary product metadata.
 * ============================================================ */

import type { Track, TrackSource } from '../../types/domain';
import { formatDurationMs } from '../../utils/duration';
import { formatTrackTagLabel, getTrackMetadataLineParts } from './trackPresentation';

export type TrackDetailPresentation = {
  title: string;
  artist: string;
  description: string;
  genres: string[];
  tags: string[];
  duration: string;
  sourceLabel: string;
  audioPublisher: string;
};

export function getTrackDetailSourceLabel(source: TrackSource): string {
  return source === 'station-upload' ? 'Station upload' : 'Existing QDN audio';
}

export function getTrackDetailPresentation(track: Track): TrackDetailPresentation {
  const metadata = getTrackMetadataLineParts(track);

  return {
    title: track.title.trim(),
    artist: track.artist?.trim() ?? '',
    description: track.description?.trim() ?? '',
    genres: metadata.genres,
    tags: metadata.tags.map((tag) => formatTrackTagLabel(tag)).filter(Boolean),
    duration: formatDurationMs(track.durationMs),
    sourceLabel: getTrackDetailSourceLabel(track.source),
    audioPublisher: track.audio.name || 'Not provided',
  };
}
