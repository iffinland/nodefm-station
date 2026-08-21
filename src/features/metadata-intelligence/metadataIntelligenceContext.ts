/* ============================================================
 * NodeFM Station — Metadata Intelligence Context
 * ============================================================ */

import { createContext, useContext } from 'react';
import type { MetadataIndex } from './metadataIntelligence';

export type MetadataIntelligenceContextValue = {
  index: MetadataIndex;
  artists: string[];
  getTitlesForArtist: (artistValue: string) => string[];
  getAlbumsForArtist: (artistValue: string) => string[];
};

export const MetadataIntelligenceContext = createContext<MetadataIntelligenceContextValue | null>(
  null,
);

export function useMetadataIntelligence(): MetadataIntelligenceContextValue {
  const value = useContext(MetadataIntelligenceContext);
  if (!value) {
    throw new Error('useMetadataIntelligence must be used within a MetadataIntelligenceProvider.');
  }
  return value;
}
