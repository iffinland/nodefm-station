/* ============================================================
 * NodeFM Station — Metadata Intelligence Provider
 *
 * Provides one role-neutral Artist/Title suggestion index to
 * every NodeFM metadata form. It consumes the already-loaded
 * Station Track collection and never performs QDN searches.
 * ============================================================ */

import { useCallback, useMemo, type ReactNode } from 'react';
import { useLibrary } from '../../hooks/useLibrary';
import {
  buildMetadataIndex,
  getArtistDisplayValues,
  getTitleDisplayValues,
} from './metadataIntelligence';
import {
  MetadataIntelligenceContext,
  type MetadataIntelligenceContextValue,
} from './metadataIntelligenceContext';

export function MetadataIntelligenceProvider({ children }: { children: ReactNode }) {
  const { tracks } = useLibrary();

  const index = useMemo(() => buildMetadataIndex(tracks), [tracks]);
  const artists = useMemo(() => getArtistDisplayValues(index), [index]);

  const getTitlesForArtist = useCallback(
    (artistValue: string) => getTitleDisplayValues(index, artistValue),
    [index],
  );

  const value: MetadataIntelligenceContextValue = useMemo(
    () => ({ index, artists, getTitlesForArtist }),
    [artists, getTitlesForArtist, index],
  );

  return (
    <MetadataIntelligenceContext.Provider value={value}>
      {children}
    </MetadataIntelligenceContext.Provider>
  );
}
