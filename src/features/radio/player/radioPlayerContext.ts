/* ============================================================
 * NodeFM Station — Radio Player Context
 *
 * Consumer context for the single live-radio controller.
 * ============================================================ */

import { createContext, useContext } from 'react';
import type { LiveRadioPlayer } from './useLiveRadioPlayer';

export const RadioPlayerContext = createContext<LiveRadioPlayer | null>(null);

export function useLiveRadioPlayerContext(): LiveRadioPlayer {
  const value = useContext(RadioPlayerContext);

  if (!value) {
    throw new Error('useLiveRadioPlayerContext must be used within LiveRadioPlayerProvider.');
  }

  return value;
}
