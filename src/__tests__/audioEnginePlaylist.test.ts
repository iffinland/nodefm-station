/* ============================================================
 * NodeFM Station — AudioEngine PLAYLIST Mode Tests
 *
 * Exercises the single global AudioEngine's playlist queue,
 * track transitions, and Return to Live reset using a small
 * fake HTMLAudioElement.
 * ============================================================ */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createAudioEngine } from '../audio';
import type { AudioTrack } from '../audio/playbackTypes';
import { resolveLiveState } from '../features/radio/timeline';
import type { PlaylistVersion, Station } from '../types/domain';

type EventMap = Record<string, Array<() => void>>;

class FakeAudio {
  static instances: FakeAudio[] = [];

  volume = 1;
  preload = 'auto';
  src = '';
  currentTime = 0;
  duration = 1000;
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
    this.events.play?.forEach((listener) => listener());
    return Promise.resolve();
  }

  pause() {
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
    durationMs: 1000,
  };
}

describe('AudioEngine PLAYLIST mode', () => {
  beforeEach(() => {
    FakeAudio.instances = [];
    vi.stubGlobal('Audio', FakeAudio);
    createAudioEngine();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('enters PLAYLIST mode and loads the selected track', () => {
    const engine = createAudioEngine();
    engine.enterPlaylistMode([track('a'), track('b')], { startIndex: 1 });

    expect(engine.getState().mode).toBe('PLAYLIST');
    expect(engine.getState().currentTrack?.trackId).toBe('b');
    expect(engine.getState().playlistQueue?.tracks).toHaveLength(2);
    expect(engine.getState().playlistQueue?.position).toBe(1);
  });

  it('next and previous move through the immutable queue', () => {
    const engine = createAudioEngine();
    engine.enterPlaylistMode([track('a'), track('b'), track('c')], { startIndex: 1 });

    engine.playNext();
    expect(engine.getState().currentTrack?.trackId).toBe('c');

    engine.playPrevious();
    expect(engine.getState().currentTrack?.trackId).toBe('b');
  });

  it('returnToLive discards playlist queue and returns mode to LIVE', () => {
    const engine = createAudioEngine();
    engine.enterPlaylistMode([track('a'), track('b')]);

    engine.returnToLive();

    expect(engine.getState().mode).toBe('LIVE');
    expect(engine.getState().playlistQueue).toBeNull();
    expect(engine.getState().currentTrack).toBeNull();
    expect(engine.getState().currentOffsetSec).toBe(0);
  });

  it('toggles loop and shuffle state without creating another audio element', () => {
    const engine = createAudioEngine();
    engine.enterPlaylistMode([track('a'), track('b')]);

    engine.togglePlaylistLoop();
    engine.togglePlaylistShuffle();

    expect(engine.getState().playlistQueue?.loopEnabled).toBe(true);
    expect(engine.getState().playlistQueue?.shuffleEnabled).toBe(true);
    expect(FakeAudio.instances).toHaveLength(1);
  });

  it('Return to Live uses current UTC timeline truth, not the stale pre-playlist live state', () => {
    const station: Station = {
      schemaVersion: 1,
      stationId: 'station-1',
      name: 'NodeFM',
      publisherName: 'NodeFM',
      ownerAddress: 'Q-owner',
      timezone: 'Europe/Helsinki',
      defaultRotationPlaylistId: 'default-playlist',
      defaultRotationPlaylistVersionId: 'v1',
      stationEpochUtc: '2026-01-01T00:00:00.000Z',
      messagingEnabled: false,
      tipsEnabled: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const version: PlaylistVersion = {
      schemaVersion: 1,
      playlistId: 'default-playlist',
      versionId: 'v1',
      versionNumber: 1,
      createdBy: 'Q-owner',
      createdAt: '2026-01-01T00:00:00.000Z',
      tracks: [
        { trackId: 'live-a', durationMs: 60_000 },
        { trackId: 'live-b', durationMs: 60_000 },
      ],
      totalDurationMs: 120_000,
    };
    const t1 = Date.parse('2026-01-01T00:00:00.000Z');
    const t2 = t1 + 90_000;

    const input = {
      station,
      scheduleEvents: [],
      playlistVersions: { v1: version },
      dynamicOccurrences: {},
    };
    const liveAtT1 = resolveLiveState(t1, input);
    const liveAtT2 = resolveLiveState(t2, input);

    expect(liveAtT1.status).toBe('ready');
    expect(liveAtT2.status).toBe('ready');
    if (liveAtT1.status !== 'ready' || liveAtT2.status !== 'ready') return;

    const engine = createAudioEngine();
    engine.enterPlaylistMode([track('playlist-track')]);
    engine.returnToLive();

    expect(engine.getState().mode).toBe('LIVE');
    expect(engine.getState().playlistQueue).toBeNull();
    expect(engine.getState().currentTrack).toBeNull();
    expect(liveAtT2.live.trackId).toBe('live-b');
    expect(liveAtT2.live.offsetMs).toBe(30_000);
    expect(liveAtT2.live.trackId).not.toBe(liveAtT1.live.trackId);
  });
});
