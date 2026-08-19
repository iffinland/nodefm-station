/* ============================================================
 * NodeFM Station — Live Radio Player Provider
 *
 * Mounts one live-radio controller above route-level pages so
 * timeline/audio sync survives internal navigation.
 * ============================================================ */

import type { ReactNode } from 'react';
import { RadioPlayerContext } from './radioPlayerContext';
import { useLiveRadioPlayer } from './useLiveRadioPlayer';

export function LiveRadioPlayerProvider({ children }: { children: ReactNode }) {
  const controller = useLiveRadioPlayer();

  return <RadioPlayerContext.Provider value={controller}>{children}</RadioPlayerContext.Provider>;
}
