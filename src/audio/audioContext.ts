/* ============================================================
 * NodeFM Station — Audio Context & Hooks
 *
 * Audio engine context and consumer hooks.
 * Separated from AudioProvider to satisfy react-refresh
 * single-component-export rule.
 * ============================================================ */

import { createContext, useContext, useSyncExternalStore } from 'react';
import { type AudioEngine } from './AudioEngine';
import type { PlayerState } from './playbackTypes';

export const AudioContext = createContext<AudioEngine | null>(null);

export function useAudioEngine(): AudioEngine {
  const engine = useContext(AudioContext);

  if (!engine) {
    throw new Error('useAudioEngine must be used within an AudioProvider');
  }

  return engine;
}

export function usePlayerState(): PlayerState {
  const engine = useAudioEngine();

  return useSyncExternalStore<PlayerState>(
    (callback) => engine.subscribe(callback),
    () => engine.getState(),
  );
}
