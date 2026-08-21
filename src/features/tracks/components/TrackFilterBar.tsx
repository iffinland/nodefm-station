/* ============================================================
 * NodeFM Station — Reusable Track Filter Bar
 *
 * Presents one shared search / Genre / Tag / Artist / sort
 * control set for any Track-selection surface.
 * ============================================================ */

import {
  hasActiveTrackFilters,
  type TrackFilterCriteria,
  type TrackFilterOptions,
  type TrackSort,
} from '../selectors/trackFiltering';
import { formatTrackTagLabel } from '../trackPresentation';

type TrackFilterBarProps = {
  filters: TrackFilterCriteria;
  sort: TrackSort;
  options: TrackFilterOptions;
  resultCount: number;
  totalCount: number;
  onFilterChange: (key: keyof TrackFilterCriteria, value: string) => void;
  onSortChange: (sort: TrackSort) => void;
  onClearFilters: () => void;
};

function pluralizeTracks(count: number): string {
  return `${count} track${count === 1 ? '' : 's'}`;
}

export function TrackFilterBar({
  filters,
  sort,
  options,
  resultCount,
  totalCount,
  onFilterChange,
  onSortChange,
  onClearFilters,
}: TrackFilterBarProps) {
  const active = hasActiveTrackFilters(filters);

  return (
    <div className="track-filter-bar">
      <div className="track-filter-bar__search">
        <input
          type="search"
          value={filters.search}
          onChange={(event) => onFilterChange('search', event.target.value)}
          placeholder="Search artist, title, genre, or tag"
          aria-label="Search tracks"
          autoComplete="off"
        />
      </div>

      <label className="track-filter-bar__field">
        <span>Genre</span>
        <select
          value={filters.genre}
          onChange={(event) => onFilterChange('genre', event.target.value)}
          aria-label="Filter by genre"
        >
          <option value="">All genres</option>
          {options.genres.map((genre) => (
            <option key={genre} value={genre}>
              {genre}
            </option>
          ))}
        </select>
      </label>

      <label className="track-filter-bar__field">
        <span>Tag</span>
        <select
          value={filters.tag}
          onChange={(event) => onFilterChange('tag', event.target.value)}
          aria-label="Filter by tag"
        >
          <option value="">All tags</option>
          {options.tags.map((tag) => (
            <option key={tag} value={tag}>
              {formatTrackTagLabel(tag)}
            </option>
          ))}
        </select>
      </label>

      <label className="track-filter-bar__field">
        <span>Artist</span>
        <select
          value={filters.artist}
          onChange={(event) => onFilterChange('artist', event.target.value)}
          aria-label="Filter by artist"
        >
          <option value="">All artists</option>
          {options.artists.map((artist) => (
            <option key={artist} value={artist}>
              {artist}
            </option>
          ))}
        </select>
      </label>

      <label className="track-filter-bar__field">
        <span>Sort</span>
        <select
          value={sort}
          onChange={(event) => onSortChange(event.target.value as TrackSort)}
          aria-label="Sort tracks"
        >
          <option value="title">Title A–Z</option>
          <option value="artist">Artist A–Z</option>
          <option value="genre">Genre A–Z</option>
          <option value="newest">Newest first</option>
        </select>
      </label>

      {active ? (
        <button
          className="button button--secondary track-filter-bar__clear"
          type="button"
          onClick={onClearFilters}
        >
          Clear filters
        </button>
      ) : null}

      <span className="track-filter-bar__count">
        {resultCount === totalCount
          ? pluralizeTracks(totalCount)
          : `${pluralizeTracks(resultCount)} of ${pluralizeTracks(totalCount)}`}
      </span>
    </div>
  );
}
