/* ============================================================
 * NodeFM Station — Playback Types
 *
 * Player mode and state types for the global audio engine.
 * ============================================================ */

export type PlayerMode = 'LIVE' | 'PLAYLIST';

export type PlaybackState =
  'idle' | 'resolving' | 'preparing' | 'buffering' | 'ready' | 'playing' | 'paused' | 'error';

export type AudioTrack = {
  url: string;
  trackId: string;
  title: string;
  artist?: string;
  coverUrl?: string;
  durationMs: number;
};

export type PlayerState = {
  mode: PlayerMode;
  playbackState: PlaybackState;
  currentTrack: AudioTrack | null;
  currentOffsetSec: number;
  volume: number;
  muted: boolean;
  error: string | null;
};
