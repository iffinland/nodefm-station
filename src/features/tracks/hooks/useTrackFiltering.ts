/* ============================================================
 * NodeFM Station — useTrackFiltering Hook
 *
 * Role-neutral Track discovery state. Each surface that uses this
 * hook owns an isolated filter/sort state instance.
 * ============================================================ */

import { useCallback, useMemo, useState } from 'react';
import type { Track } from '../../../types/domain';
import {
  buildTrackFilterOptions,
  buildTrackSearchIndex,
  DEFAULT_TRACK_SORT,
  EMPTY_TRACK_FILTERS,
  filterAndSortTracks,
  type TrackFilterCriteria,
  type TrackSort,
} from '../selectors/trackFiltering';

export type UseTrackFilteringResult = {
  filters: TrackFilterCriteria;
  sort: TrackSort;
  options: ReturnType<typeof buildTrackFilterOptions>;
  visibleTracks: Track[];
  setFilter: (key: keyof TrackFilterCriteria, value: string) => void;
  setSort: (sort: TrackSort) => void;
  clearFilters: () => void;
  resetAll: () => void;
};

export function useTrackFiltering(tracks: readonly Track[]): UseTrackFilteringResult {
  const [filters, setFilters] = useState<TrackFilterCriteria>(EMPTY_TRACK_FILTERS);
  const [sort, setSort] = useState<TrackSort>(DEFAULT_TRACK_SORT);

  const options = useMemo(() => buildTrackFilterOptions(tracks), [tracks]);
  const searchIndex = useMemo(() => buildTrackSearchIndex(tracks), [tracks]);
  const visibleTracks = useMemo(
    () => filterAndSortTracks(tracks, filters, sort, searchIndex),
    [filters, searchIndex, sort, tracks],
  );

  const setFilter = useCallback((key: keyof TrackFilterCriteria, value: string) => {
    setFilters((current) => (current[key] === value ? current : { ...current, [key]: value }));
  }, []);

  const clearFilters = useCallback(() => {
    setFilters({ ...EMPTY_TRACK_FILTERS });
  }, []);

  const resetAll = useCallback(() => {
    setFilters({ ...EMPTY_TRACK_FILTERS });
    setSort(DEFAULT_TRACK_SORT);
  }, []);

  return {
    filters,
    sort,
    options,
    visibleTracks,
    setFilter,
    setSort,
    clearFilters,
    resetAll,
  };
}
