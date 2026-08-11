/* ============================================================
 * NodeFM Station — Audio Provider
 *
 * React context provider for the global audio engine.
 * Placed above route-level pages so playback survives navigation.
 * ============================================================ */

import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { getAudioEngine } from './AudioEngine';
import { AudioContext } from './audioContext';
import type { PlayerState } from './playbackTypes';

export function AudioProvider({ children }: { children: ReactNode }) {
  const engine = getAudioEngine();

  // Subscribe React to engine state changes
  useSyncExternalStore<PlayerState>(
    (callback) => engine.subscribe(callback),
    () => engine.getState(),
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // We do NOT destroy the engine on unmount — it needs to persist
      // across navigations. Only destroy at the true app root teardown.
    };
  }, []);

  return <AudioContext.Provider value={engine}>{children}</AudioContext.Provider>;
}
