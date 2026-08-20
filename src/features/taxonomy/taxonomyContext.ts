/* ============================================================
 * NodeFM Station — Taxonomy Context
 * ============================================================ */

import { createContext, useContext } from 'react';
import type { TaxonomyKind } from './taxonomyMemory';

export type TaxonomyContextValue = {
  genres: string[];
  tags: string[];
  remember: (kind: TaxonomyKind, values: readonly string[]) => void;
};

export const TaxonomyContext = createContext<TaxonomyContextValue | null>(null);

export function useTaxonomy(): TaxonomyContextValue {
  const value = useContext(TaxonomyContext);
  if (!value) {
    throw new Error('useTaxonomy must be used within a TaxonomyProvider.');
  }
  return value;
}
