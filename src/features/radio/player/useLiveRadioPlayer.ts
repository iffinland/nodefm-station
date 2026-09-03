/* ============================================================
 * NodeFM Station — useLiveRadioPlayer
 *
 * Bridges the pure radio timeline to the global AudioEngine.
 * The timeline says what should be live and at what offset;
 * this hook performs load/seek/resync and exposes a small set
 * of LIVE player controls.
 *
 * If the canonical current track is confirmed missing/unusable, the
 * player advances deterministically to the next playable candidate
 * without mutating the canonical timeline.
 * ============================================================ */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AudioTrack, PlayerState } from '../../../audio/playbackTypes';
import { useAudioEngine, usePlayerState } from '../../../audio';
import type { Track } from '../../../types/domain';
import type { LiveState } from '../timeline';
import { useRadioTimeline } from '../hooks/useRadioTimeline';
import {
  getLivePlaybackRetryDelayMs,
  resolveLivePlaybackCandidate,
  shouldStartLivePlaybackResolution,
  type LivePlaybackCandidate,
} from './livePlaybackFallback';
import { resolveTrackCoverUrl, resolveTrackPlayback } from './resolveTrackPlayback';
import { recordStartupEvent } from '../../../services/perf/startupDiagnostics';

const HARD_RESYNC_SEC = 3;
const READY_STATES = new Set(['ready', 'playing', 'paused']);
const RETRY_DELAY_MS = 5_000;

function trackPlaybackSignature(track: Track): string {
  return [
    track.trackId,
    track.audio.service,
    track.audio.name,
    track.audio.identifier ?? '',
    track.updatedAt,
  ].join('\u0000');
}

function liveContextKey(
  live: LiveState | null,
  candidates: readonly LivePlaybackCandidate[],
): string | null {
  if (!live) {
    return null;
  }

  const candidateKey = candidates
    .map((candidate) =>
      [
        candidate.trackId,
        candidate.durationMs,
        candidate.trackStartUtcMs,
        candidate.trackEndUtcMs,
        candidate.metadata?.updatedAt ?? '',
        candidate.metadata?.audio.service ?? '',
        candidate.metadata?.audio.name ?? '',
        candidate.metadata?.audio.identifier ?? '',
      ].join('\u0000'),
    )
    .join('|');

  return [
    live.mode,
    live.trackId,
    live.sourceStartUtcMs,
    live.sourceEndUtcMs ?? '',
    live.trackStartUtcMs,
    live.trackEndUtcMs,
    live.nextTransitionUtcMs ?? '',
    candidateKey,
  ].join('\u0000');
}

function formatSkippedWarning(skippedTrackIds: readonly string[]): string | null {
  if (skippedTrackIds.length === 0) {
    return null;
  }

  return `Skipped unavailable track${skippedTrackIds.length === 1 ? '' : 's'}: ${skippedTrackIds.join(
    ', ',
  )}`;
}

export type LiveRadioPlayer = {
  timeline: ReturnType<typeof useRadioTimeline>;
  playerState: PlayerState;
  playbackError: string | null;
  playbackWarning: string | null;
  togglePlayPause: () => void;
  playPlaylist: (
    tracks: readonly AudioTrack[],
    options?: {
      startIndex?: number;
      autoplay?: boolean;
      shuffle?: boolean;
      loop?: boolean;
    },
  ) => void;
  playNext: () => void;
  playPrevious: () => void;
  togglePlaylistShuffle: () => void;
  togglePlaylistLoop: () => void;
  seek: (offsetSec: number) => boolean;
  returnToLive: () => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  retry: () => void;
};

export function useLiveRadioPlayer(): LiveRadioPlayer {
  const timeline = useRadioTimeline();
  const engine = useAudioEngine();
  const playerState = usePlayerState();

  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [playbackWarning, setPlaybackWarning] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  const playerStateRef = useRef(playerState);
  playerStateRef.current = playerState;

  const timelineLiveRef = useRef(timeline.liveState);
  timelineLiveRef.current = timeline.liveState;

  const loadedTrackIdRef = useRef<string | null>(null);
  const loadedSignatureRef = useRef<string | null>(null);
  const loadedContextKeyRef = useRef<string | null>(null);
  const resolvingContextKeyRef = useRef<string | null>(null);
  const resolutionGenerationRef = useRef(0);
  const resolutionInFlightRef = useRef(false);
  const retryContextKeyRef = useRef<string | null>(null);
  const retryAfterUtcMsRef = useRef(0);
  const userPausedRef = useRef(false);
  const firstPlayableRecordedRef = useRef(false);

  const playIfAllowed = useCallback(() => {
    if (!userPausedRef.current) {
      engine.play();
    }
  }, [engine]);

  const resolveLiveContext = useCallback(
    async (
      live: LiveState,
      candidates: readonly LivePlaybackCandidate[],
      contextKey: string,
      generation: number,
    ) => {
      try {
        const resolution = await resolveLivePlaybackCandidate(candidates, {
          startIndex: live.trackIndex,
          sourceEndUtcMs: live.sourceEndUtcMs,
          resolveTrack: resolveTrackPlayback,
        });

        if (generation !== resolutionGenerationRef.current) {
          return;
        }

        if (playerStateRef.current.mode !== 'LIVE') {
          return;
        }

        const latestLive = timelineLiveRef.current;
        if (!latestLive || liveContextKey(latestLive, candidates) !== contextKey) {
          return;
        }

        if (resolution.status === 'fatal') {
          retryContextKeyRef.current = contextKey;
          retryAfterUtcMsRef.current = Date.now() + getLivePlaybackRetryDelayMs(resolution)!;
          setPlaybackError(resolution.message);
          setPlaybackWarning(null);
          return;
        }

        if (resolution.status === 'no-playable-track') {
          retryContextKeyRef.current = contextKey;
          retryAfterUtcMsRef.current = Date.now() + getLivePlaybackRetryDelayMs(resolution)!;
          setPlaybackError('No playable tracks are currently available.');
          setPlaybackWarning(formatSkippedWarning(resolution.skippedTrackIds));
          return;
        }

        const isCanonical = resolution.track.trackId === latestLive.trackId;
        const offsetSec = isCanonical ? latestLive.offsetMs / 1000 : 0;

        loadedTrackIdRef.current = resolution.track.trackId;
        loadedSignatureRef.current = trackPlaybackSignature(resolution.track);
        loadedContextKeyRef.current = contextKey;
        retryContextKeyRef.current = null;
        retryAfterUtcMsRef.current = 0;
        setPlaybackError(null);
        setPlaybackWarning(formatSkippedWarning(resolution.skippedTrackIds));

        if (!firstPlayableRecordedRef.current) {
          firstPlayableRecordedRef.current = true;
          recordStartupEvent('FIRST_PLAYABLE_LIVE_SOURCE', {
            completion: 'success',
            detail: resolution.track.trackId,
          });
        }

        engine.load(
          {
            url: resolution.playback.audioUrl,
            trackId: resolution.track.trackId,
            title: resolution.track.title,
            artist: resolution.track.artist,
            durationMs: resolution.track.durationMs,
          },
          offsetSec,
        );

        void resolveTrackCoverUrl(resolution.track).then((coverUrl) => {
          if (coverUrl) {
            engine.updateTrackCover(resolution.track.trackId, coverUrl);
          }
        });

        playIfAllowed();
      } finally {
        if (generation === resolutionGenerationRef.current) {
          resolutionInFlightRef.current = false;
          resolvingContextKeyRef.current = null;
        }
      }
    },
    [engine, playIfAllowed],
  );

  const startResolution = useCallback(
    (live: LiveState, candidates: readonly LivePlaybackCandidate[], contextKey: string) => {
      resolutionGenerationRef.current += 1;
      const generation = resolutionGenerationRef.current;
      resolutionInFlightRef.current = true;
      resolvingContextKeyRef.current = contextKey;
      retryContextKeyRef.current = null;
      retryAfterUtcMsRef.current = 0;
      setPlaybackError(null);
      setPlaybackWarning(null);
      void resolveLiveContext(live, candidates, contextKey, generation);
    },
    [resolveLiveContext],
  );

  const liveMode = timeline.liveState?.mode;
  const liveTrackId = timeline.liveState?.trackId;
  const liveTrackIndex = timeline.liveState?.trackIndex;
  const liveTrackStartUtcMs = timeline.liveState?.trackStartUtcMs;
  const liveTrackEndUtcMs = timeline.liveState?.trackEndUtcMs;
  const liveSourceEndUtcMs = timeline.liveState?.sourceEndUtcMs;

  useEffect(() => {
    if (playerState.mode !== 'LIVE') {
      return;
    }

    const live = timelineLiveRef.current;
    if (!live) {
      return;
    }

    const candidates = timeline.playbackCandidates;
    const contextKey = liveContextKey(live, candidates);

    if (
      !contextKey ||
      !shouldStartLivePlaybackResolution(
        contextKey,
        loadedContextKeyRef.current,
        resolvingContextKeyRef.current,
        retryContextKeyRef.current,
        retryAfterUtcMsRef.current,
        Date.now(),
      )
    ) {
      return;
    }

    startResolution(live, candidates, contextKey);
  }, [
    playerState.mode,
    liveMode,
    liveTrackId,
    liveTrackIndex,
    liveTrackStartUtcMs,
    liveTrackEndUtcMs,
    liveSourceEndUtcMs,
    timeline.playbackCandidates,
    retryNonce,
    startResolution,
  ]);

  useEffect(() => {
    if (playerState.mode !== 'LIVE') {
      return;
    }

    const live = timelineLiveRef.current;
    if (!live) {
      return;
    }

    const candidates = timeline.playbackCandidates;
    const contextKey = liveContextKey(live, candidates);

    if (
      !contextKey ||
      loadedContextKeyRef.current === contextKey ||
      resolutionInFlightRef.current
    ) {
      return;
    }

    const timer = window.setInterval(() => {
      if (
        loadedContextKeyRef.current !== contextKey &&
        !resolutionInFlightRef.current &&
        (retryContextKeyRef.current !== contextKey || Date.now() >= retryAfterUtcMsRef.current)
      ) {
        setRetryNonce((value) => value + 1);
      }
    }, RETRY_DELAY_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [
    playerState.mode,
    liveMode,
    liveTrackId,
    liveTrackIndex,
    liveTrackStartUtcMs,
    liveTrackEndUtcMs,
    liveSourceEndUtcMs,
    timeline.playbackCandidates,
  ]);

  useEffect(() => {
    if (playerState.mode !== 'LIVE') {
      return;
    }

    const timer = window.setInterval(() => {
      const live = timelineLiveRef.current;
      if (!live || loadedTrackIdRef.current !== live.trackId) {
        return;
      }

      const state = playerStateRef.current;
      if (!READY_STATES.has(state.playbackState)) {
        return;
      }

      const expectedSec = live.offsetMs / 1000;
      const actualSec = engine.getCurrentTime();
      if (Math.abs(actualSec - expectedSec) > HARD_RESYNC_SEC) {
        engine.seek(expectedSec);
      }
    }, 1_000);

    return () => {
      window.clearInterval(timer);
    };
  }, [engine, playerState.mode, liveTrackId]);

  const togglePlayPause = useCallback(() => {
    if (playerState.playbackState === 'playing') {
      userPausedRef.current = true;
      engine.pause();
      return;
    }

    userPausedRef.current = false;

    if (playerState.mode === 'LIVE') {
      const live = timelineLiveRef.current;
      if (live && loadedTrackIdRef.current === live.trackId) {
        // Resume from the canonical UTC offset at this exact moment instead
        // of the stale paused media time.
        engine.seek(live.offsetMs / 1000);
      }
    }

    engine.play();
  }, [engine, playerState.mode, playerState.playbackState]);

  const playPlaylist = useCallback(
    (
      tracks: readonly AudioTrack[],
      options: {
        startIndex?: number;
        autoplay?: boolean;
        shuffle?: boolean;
        loop?: boolean;
      } = {},
    ) => {
      userPausedRef.current = false;
      resolutionGenerationRef.current += 1;
      resolutionInFlightRef.current = false;
      resolvingContextKeyRef.current = null;
      retryContextKeyRef.current = null;
      retryAfterUtcMsRef.current = 0;
      setPlaybackError(null);
      setPlaybackWarning(null);
      engine.enterPlaylistMode(tracks, options);
    },
    [engine],
  );

  const playNext = useCallback(() => {
    engine.playNext();
  }, [engine]);

  const playPrevious = useCallback(() => {
    engine.playPrevious();
  }, [engine]);

  const togglePlaylistShuffle = useCallback(() => {
    engine.togglePlaylistShuffle();
  }, [engine]);

  const togglePlaylistLoop = useCallback(() => {
    engine.togglePlaylistLoop();
  }, [engine]);

  const seek = useCallback((offsetSec: number) => engine.seek(offsetSec), [engine]);

  const returnToLive = useCallback(() => {
    userPausedRef.current = false;
    loadedTrackIdRef.current = null;
    loadedSignatureRef.current = null;
    loadedContextKeyRef.current = null;
    resolvingContextKeyRef.current = null;
    resolutionInFlightRef.current = false;
    retryContextKeyRef.current = null;
    resolutionGenerationRef.current += 1;
    retryAfterUtcMsRef.current = 0;
    setPlaybackError(null);
    setPlaybackWarning(null);
    engine.returnToLive();
    setRetryNonce((value) => value + 1);
  }, [engine]);

  const retry = useCallback(() => {
    loadedTrackIdRef.current = null;
    loadedSignatureRef.current = null;
    loadedContextKeyRef.current = null;
    resolvingContextKeyRef.current = null;
    resolutionGenerationRef.current += 1;
    resolutionInFlightRef.current = false;
    retryContextKeyRef.current = null;
    retryAfterUtcMsRef.current = 0;
    setPlaybackError(null);
    setPlaybackWarning(null);
    setRetryNonce((value) => value + 1);
  }, []);

  return {
    timeline,
    playerState,
    playbackError,
    playbackWarning,
    togglePlayPause,
    playPlaylist,
    playNext,
    playPrevious,
    togglePlaylistShuffle,
    togglePlaylistLoop,
    seek,
    returnToLive,
    setVolume: engine.setVolume.bind(engine),
    toggleMute: engine.toggleMute.bind(engine),
    retry,
  };
}
