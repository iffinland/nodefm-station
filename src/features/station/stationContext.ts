/* ============================================================
 * NodeFM Station — Station Context
 *
 * Consumer-facing station config + ownership context.
 * ============================================================ */

import { createContext, useContext } from 'react';
import type { Station } from '../../types/domain';
import type { StationSaveInput } from './services/stationService';

export type StationContextValue = {
  station: Station | null;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  publisherName: string | null;
  isOwner: boolean;
  saveStation: (input: StationSaveInput) => Promise<Station>;
  refresh: () => Promise<void>;
};

export const StationContext = createContext<StationContextValue>({
  station: null,
  loaded: false,
  loading: false,
  error: null,
  publisherName: null,
  isOwner: false,
  saveStation: async () => {
    throw new Error('StationProvider is missing.');
  },
  refresh: async () => {},
});

export function useStation(): StationContextValue {
  return useContext(StationContext);
}
