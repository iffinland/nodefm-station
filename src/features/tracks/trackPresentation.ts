/* ============================================================
 * NodeFM Station — Reusable Track Presentation Helpers
 *
 * Pure metadata formatting shared by Library cards, Playlist
 * Track pickers, and future Track selectors.
 * ============================================================ */

import type { Track } from '../../types/domain';
import { normalizeTaxonomyValue, splitTaxonomyValues } from '../taxonomy';

export type TrackMetadataLineParts = {
  genres: string[];
  tags: string[];
};

export function normalizeTrackGenres(track: Pick<Track, 'genres'>): string[] {
  return splitTaxonomyValues((track.genres ?? []).join(','));
}

export function normalizeTrackTags(track: Pick<Track, 'tags'>): string[] {
  return splitTaxonomyValues((track.tags ?? []).join(','));
}

export function formatTrackTagLabel(tag: string): string {
  const normalized = normalizeTaxonomyValue(tag);
  if (!normalized) return '';
  const displayValue = normalized.startsWith('#')
    ? normalizeTaxonomyValue(normalized.slice(1))
    : normalized;
  return displayValue ? `#${displayValue}` : '';
}

export function getTrackPrimaryLabel(track: Pick<Track, 'artist' | 'title'>): string {
  const artist = normalizeTaxonomyValue(track.artist ?? '');
  const title = normalizeTaxonomyValue(track.title);
  return artist ? `${artist} — ${title}` : title;
}

export function getTrackMetadataLineParts(
  track: Pick<Track, 'genres' | 'tags'>,
): TrackMetadataLineParts {
  return {
    genres: normalizeTrackGenres(track),
    tags: normalizeTrackTags(track).map(formatTrackTagLabel).filter(Boolean),
  };
}

export function getTrackMetadataText(parts: TrackMetadataLineParts): string {
  const genres = parts.genres.join(', ');
  const tags = parts.tags.join(' ');

  if (genres && tags) return `${genres}  ${tags}`;
  if (genres) return genres;
  return tags;
}
