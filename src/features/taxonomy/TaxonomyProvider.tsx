/* ============================================================
 * NodeFM Station — Taxonomy Provider
 *
 * Provides the unified Tags/Genres suggestion pool to every
 * NodeFM form. Suggestions come from the canonical Station Track
 * metadata first, then from best-effort session-level learned
 * values.
 * ============================================================ */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLibrary } from '../../hooks/useLibrary';
import { useStationIdentity } from '../station';
import { TaxonomyContext, type TaxonomyContextValue } from './taxonomyContext';
import {
  loadTaxonomyMemory,
  rememberTaxonomyValues,
  type TaxonomyKind,
  type TaxonomyMemory,
} from './taxonomyMemory';
import { mergeTaxonomySuggestions } from './taxonomyService';

export function TaxonomyProvider({ children }: { children: ReactNode }) {
  const { tracks } = useLibrary();
  const { ownerAddress, publisherName } = useStationIdentity();
  const memoryScope = publisherName ?? ownerAddress ?? 'public';
  const [memory, setMemory] = useState<TaxonomyMemory>(() => loadTaxonomyMemory(memoryScope));

  useEffect(() => {
    setMemory(loadTaxonomyMemory(memoryScope));
  }, [memoryScope]);

  const stationGenres = useMemo(
    () =>
      mergeTaxonomySuggestions(
        [],
        tracks.flatMap((track) => track.genres ?? []),
      ),
    [tracks],
  );
  const stationTags = useMemo(
    () =>
      mergeTaxonomySuggestions(
        [],
        tracks.flatMap((track) => track.tags ?? []),
      ),
    [tracks],
  );

  const genres = useMemo(
    () => mergeTaxonomySuggestions(stationGenres, memory.genres),
    [memory.genres, stationGenres],
  );
  const tags = useMemo(
    () => mergeTaxonomySuggestions(stationTags, memory.tags),
    [memory.tags, stationTags],
  );

  const remember = useCallback(
    (kind: TaxonomyKind, values: readonly string[]) => {
      setMemory((current) => rememberTaxonomyValues(memoryScope, kind, values) ?? current);
    },
    [memoryScope],
  );

  const value: TaxonomyContextValue = useMemo(
    () => ({ genres, tags, remember }),
    [genres, remember, tags],
  );

  return <TaxonomyContext.Provider value={value}>{children}</TaxonomyContext.Provider>;
}
