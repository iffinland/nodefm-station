/* ============================================================
 * NodeFM Station — Audio Engine
 *
 * Global audio playback engine.
 * Only one instance should exist in the app.
 * It does NOT decide what is scheduled — that is the
 * RadioTimelineEngine's responsibility (Phase 3).
 *
 * Phase 1: skeleton with core playback mechanics only.
 * ============================================================ */

import type { AudioTrack, PlaybackState, PlayerMode, PlayerState } from './playbackTypes';

type PlayerListener = (state: PlayerState) => void;

const DEFAULT_VOLUME = 0.8;

export class AudioEngine {
  private audio: HTMLAudioElement | null = null;
  private pendingSeekSec: number | null = null;
  private lastTimeUpdateAt = 0;
  private state: PlayerState;
  private listeners = new Set<PlayerListener>();

  constructor() {
    this.state = {
      mode: 'LIVE',
      playbackState: 'idle',
      currentTrack: null,
      currentOffsetSec: 0,
      volume: DEFAULT_VOLUME,
      muted: false,
      error: null,
    };
  }

  // ── Initialization ──────────────────────────────────────────────

  private ensureAudio(): HTMLAudioElement {
    if (!this.audio) {
      this.audio = new Audio();
      this.audio.volume = this.state.muted ? 0 : this.state.volume;
      this.audio.preload = 'auto';

      this.audio.addEventListener('play', () => this.updatePlaybackState('playing'));
      this.audio.addEventListener('pause', () => {
        // Only set paused if not caused by a load/error
        if (this.state.playbackState !== 'error' && this.state.playbackState !== 'idle') {
          this.updatePlaybackState('paused');
        }
      });
      this.audio.addEventListener('waiting', () => this.updatePlaybackState('buffering'));
      this.audio.addEventListener('canplay', () => this.updatePlaybackState('ready'));
      this.audio.addEventListener('loadedmetadata', () => this.applyPendingSeek());
      this.audio.addEventListener('canplay', () => this.applyPendingSeek());
      this.audio.addEventListener('timeupdate', () => {
        const now = Date.now();
        if (now - this.lastTimeUpdateAt < 250) {
          return;
        }

        this.lastTimeUpdateAt = now;
        const currentTime = this.audio?.currentTime ?? 0;
        this.state = { ...this.state, currentOffsetSec: currentTime };
        this.notify();
      });
      this.audio.addEventListener('error', () => {
        this.notifyError('Audio playback error.');
      });
      this.audio.addEventListener('ended', () => {
        // Track ended — in Phase 3 this will trigger next-track logic
        this.updatePlaybackState('ready');
      });
    }

    return this.audio;
  }

  // ── State Management ────────────────────────────────────────────

  private updatePlaybackState(playbackState: PlaybackState): void {
    this.state = { ...this.state, playbackState, error: null };
    this.notify();
  }

  private notifyError(message: string): void {
    this.state = { ...this.state, playbackState: 'error', error: message };
    this.notify();
  }

  private applyPendingSeek(): void {
    if (this.pendingSeekSec === null) {
      return;
    }

    const target = this.pendingSeekSec;
    if (this.seek(target)) {
      this.pendingSeekSec = null;
    }
  }

  private notify(): void {
    const snapshot = this.getState();
    this.listeners.forEach((fn) => {
      try {
        fn(snapshot);
      } catch {
        // Guard against listener errors
      }
    });
  }

  // ── Public API ──────────────────────────────────────────────────

  getMode(): PlayerMode {
    return this.state.mode;
  }

  getState(): PlayerState {
    return this.state;
  }

  subscribe(listener: PlayerListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Load a track and prepare for playback */
  load(track: AudioTrack, offsetSec?: number): void {
    const audio = this.ensureAudio();
    this.pendingSeekSec =
      typeof offsetSec === 'number' && Number.isFinite(offsetSec) && offsetSec >= 0
        ? offsetSec
        : null;
    this.state = {
      ...this.state,
      currentTrack: track,
      playbackState: 'resolving',
      currentOffsetSec: this.pendingSeekSec ?? 0,
      error: null,
    };
    this.notify();

    audio.src = track.url;
    audio.load();
  }

  /** Update cover art after audio has started loading; ignores stale track changes. */
  updateTrackCover(trackId: string, coverUrl: string): void {
    if (!this.state.currentTrack || this.state.currentTrack.trackId !== trackId) {
      return;
    }

    this.state = {
      ...this.state,
      currentTrack: { ...this.state.currentTrack, coverUrl },
    };
    this.notify();
  }

  play(): void {
    const audio = this.ensureAudio();
    audio.play().catch((error) => {
      // Browser autoplay policy — surface gracefully
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        this.updatePlaybackState('paused');
      } else {
        this.notifyError(error instanceof Error ? error.message : 'Playback failed.');
      }
    });
  }

  pause(): void {
    this.audio?.pause();
  }

  togglePlayPause(): void {
    if (this.state.playbackState === 'playing') {
      this.pause();
    } else {
      this.play();
    }
  }

  seek(offsetSec: number): boolean {
    if (!this.audio) {
      return false;
    }

    const clamped = Math.max(0, offsetSec);

    try {
      this.audio.currentTime = clamped;
    } catch {
      // The media element is not seekable yet. The pending-seek path
      // will retry once metadata is available.
      return false;
    }

    this.state = { ...this.state, currentOffsetSec: clamped };
    this.notify();
    return true;
  }

  getCurrentTime(): number {
    return this.audio?.currentTime ?? 0;
  }

  setVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume));
    this.state = { ...this.state, volume: clamped, muted: clamped === 0 };
    if (this.audio && !this.state.muted) {
      this.audio.volume = clamped;
    }
    this.notify();
  }

  toggleMute(): void {
    const muted = !this.state.muted;
    this.state = { ...this.state, muted };
    if (this.audio) {
      this.audio.volume = muted ? 0 : this.state.volume;
    }
    this.notify();
  }

  setMode(mode: PlayerMode): void {
    this.state = { ...this.state, mode };
    this.notify();
  }

  /** Reset to LIVE mode — the caller must recalculate the live position. */
  returnToLive(): void {
    if (this.audio) {
      this.audio.pause();
      this.audio.src = '';
      this.audio.load();
    }

    this.pendingSeekSec = null;
    this.state = { ...this.state, mode: 'LIVE', playbackState: 'idle', currentTrack: null };
    this.notify();
  }

  destroy(): void {
    if (this.audio) {
      this.audio.pause();
      this.audio.src = '';
      this.audio.load();
      this.audio = null;
    }
    this.pendingSeekSec = null;
    this.lastTimeUpdateAt = 0;
    this.listeners.clear();
    this.state = {
      mode: 'LIVE',
      playbackState: 'idle',
      currentTrack: null,
      currentOffsetSec: 0,
      volume: this.state.volume,
      muted: false,
      error: null,
    };
  }
}

/** Singleton audio engine instance. Create once at app root. */
let engineInstance: AudioEngine | null = null;

export function getAudioEngine(): AudioEngine {
  if (!engineInstance) {
    engineInstance = new AudioEngine();
  }

  return engineInstance;
}

export function createAudioEngine(): AudioEngine {
  if (engineInstance) {
    engineInstance.destroy();
  }

  engineInstance = new AudioEngine();
  return engineInstance;
}
