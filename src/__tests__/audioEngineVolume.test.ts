/* ============================================================
 * NodeFM Station — AudioEngine Volume Synchronization Tests
 *
 * The media element must always reflect the effective volume,
 * including the non-zero-to-zero slider transition.
 * ============================================================ */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAudioEngine } from '../audio';
import type { AudioTrack } from '../audio/playbackTypes';

class FakeAudio {
  static instances: FakeAudio[] = [];

  volume = 1;
  preload = 'auto';
  src = '';
  currentTime = 0;
  duration = 1000;
  paused = true;

  constructor() {
    FakeAudio.instances.push(this);
  }

  addEventListener() {}

  load() {}

  play() {
    this.paused = false;
    return Promise.resolve();
  }

  pause() {
    this.paused = true;
  }
}

function track(id: string): AudioTrack {
  return {
    trackId: id,
    title: id,
    url: `https://example.com/${id}.mp3`,
    durationMs: 60_000,
  };
}

describe('AudioEngine volume synchronization', () => {
  beforeEach(() => {
    FakeAudio.instances = [];
    vi.stubGlobal('Audio', FakeAudio);
    createAudioEngine();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('silences the media element when the slider moves from non-zero to zero', () => {
    const engine = createAudioEngine();
    engine.load(track('live-a'), 0);
    engine.play();
    engine.setVolume(0.5);

    const media = FakeAudio.instances[0];
    expect(media.volume).toBe(0.5);

    engine.setVolume(0);

    expect(engine.getState().volume).toBe(0);
    expect(engine.getState().muted).toBe(true);
    expect(media.volume).toBe(0);
  });

  it('restores media volume when moving from zero to a non-zero value', () => {
    const engine = createAudioEngine();
    engine.load(track('live-a'), 0);
    engine.play();
    engine.setVolume(0);
    engine.setVolume(0.7);

    expect(FakeAudio.instances[0].volume).toBe(0.7);
    expect(engine.getState().muted).toBe(false);
  });

  it('preserves effective volume across LIVE and PLAYLIST track changes', () => {
    const engine = createAudioEngine();
    engine.load(track('live-a'), 0);
    engine.play();
    engine.setVolume(0);

    expect(FakeAudio.instances[0].volume).toBe(0);

    engine.enterPlaylistMode([track('playlist-a')]);
    expect(FakeAudio.instances[0].volume).toBe(0);

    engine.setVolume(0.4);
    expect(FakeAudio.instances[0].volume).toBe(0.4);
  });

  it('keeps mute toggle synchronized with the effective volume', () => {
    const engine = createAudioEngine();
    engine.load(track('live-a'), 0);
    engine.play();
    engine.setVolume(0.6);

    engine.toggleMute();
    expect(FakeAudio.instances[0].volume).toBe(0);

    engine.toggleMute();
    expect(FakeAudio.instances[0].volume).toBe(0.6);
  });
});
