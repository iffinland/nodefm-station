/* ============================================================
 * NodeFM Station — AudioEngine LIVE Pause Regression Tests
 *
 * Covers the production AudioEngine state machine that drives the
 * global bottom player. The confirmed bug was that `canplay` and
 * `waiting` events downgraded an actively playing (or explicitly
 * paused) LIVE media element, desyncing the Play/Pause button from
 * the real media element. These tests exercise the real engine and
 * a faithful HTMLAudioElement stand-in.
 * ============================================================ */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAudioEngine } from '../audio';
import type { AudioTrack } from '../audio/playbackTypes';

type EventMap = Record<string, Array<() => void>>;

class FakeAudio {
  static instances: FakeAudio[] = [];

  volume = 1;
  preload = 'auto';
  src = '';
  currentTime = 0;
  paused = true;
  playCalls = 0;
  pauseCalls = 0;
  private events: EventMap = {};

  constructor() {
    FakeAudio.instances.push(this);
  }

  addEventListener(type: string, listener: () => void) {
    this.events[type] ??= [];
    this.events[type].push(listener);
  }

  load() {}

  play() {
    this.playCalls += 1;
    this.paused = false;
    this.events.play?.forEach((listener) => listener());
    return Promise.resolve();
  }

  pause() {
    this.pauseCalls += 1;
    this.paused = true;
    this.events.pause?.forEach((listener) => listener());
  }

  emit(type: string) {
    this.events[type]?.forEach((listener) => listener());
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

describe('AudioEngine LIVE play/pause state machine', () => {
  beforeEach(() => {
    FakeAudio.instances = [];
    vi.stubGlobal('Audio', FakeAudio);
    createAudioEngine();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stays in `playing` when canplay/waiting fire during an active play', () => {
    const engine = createAudioEngine();
    engine.load(track('live-a'), 0);
    engine.play();

    expect(engine.getState().playbackState).toBe('playing');

    const media = FakeAudio.instances[0];
    media.emit('waiting');
    media.emit('canplay');
    media.emit('canplaythrough');

    expect(engine.getState().playbackState).toBe('playing');
    expect(media.playCalls).toBe(1);
  });

  it('actually pauses LIVE audio and does not let canplay downgrade the paused state', () => {
    const engine = createAudioEngine();
    engine.load(track('live-a'), 0);
    engine.play();
    engine.pause();

    const media = FakeAudio.instances[0];
    expect(media.paused).toBe(true);
    expect(engine.getState().playbackState).toBe('paused');

    // A seek/resync after pause can emit canplay in real browsers. The UI
    // must remain paused, and no new play must be issued.
    media.emit('canplay');
    media.emit('canplaythrough');

    expect(engine.getState().playbackState).toBe('paused');
    expect(media.paused).toBe(true);
    expect(media.playCalls).toBe(1);
  });

  it('resync seek while paused does not auto-play the media element', () => {
    const engine = createAudioEngine();
    engine.load(track('live-a'), 0);
    engine.play();
    engine.pause();

    const media = FakeAudio.instances[0];
    engine.seek(12);

    expect(media.paused).toBe(true);
    expect(media.playCalls).toBe(1);
    expect(engine.getState().playbackState).toBe('paused');
    expect(engine.getCurrentTime()).toBe(12);
  });

  it('resumes playback from the last synced position after a pause', () => {
    const engine = createAudioEngine();
    engine.load(track('live-a'), 0);
    engine.play();
    engine.pause();
    engine.seek(12);

    const media = FakeAudio.instances[0];
    engine.play();

    expect(media.paused).toBe(false);
    expect(engine.getCurrentTime()).toBe(12);
    expect(engine.getState().playbackState).toBe('playing');
  });

  it('keeps volume and mute state intact across pause and canplay transitions', () => {
    const engine = createAudioEngine();
    engine.setVolume(0.42);
    engine.toggleMute();
    engine.load(track('live-a'), 0);
    engine.play();
    engine.pause();

    const media = FakeAudio.instances[0];
    media.emit('canplay');

    expect(engine.getState().volume).toBe(0.42);
    expect(engine.getState().muted).toBe(true);
    expect(media.volume).toBe(0);
  });
});
