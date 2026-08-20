/* ============================================================
 * NodeFM Station — useLiveRadioPlayer
 *
 * Bridges the pure radio timeline to the global AudioEngine.
 * The timeline says what should be live and at what offset;
 * this hook performs load/seek/resync and exposes a small set
 * of LIVE player controls.
 * ============================================================ */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AudioTrack, PlayerState } from '../../../audio/playbackTypes';
import { useAudioEngine, usePlayerState } from '../../../audio';
import type { Track } from '../../../types/domain';
import { useRadioTimeline } from '../hooks/useRadioTimeline';
import { resolveTrackCoverUrl, resolveTrackPlayback } from './resolveTrackPlayback';

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

export type LiveRadioPlayer = {
  timeline: ReturnType<typeof useRadioTimeline>;
  playerState: PlayerState;
  playbackError: string | null;
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
  const [retryNonce, setRetryNonce] = useState(0);

  const playerStateRef = useRef(playerState);
  playerStateRef.current = playerState;

  const timelineLiveRef = useRef(timeline.liveState);
  timelineLiveRef.current = timeline.liveState;

  const currentTrackRef = useRef(timeline.currentTrack);
  currentTrackRef.current = timeline.currentTrack;

  const loadedTrackIdRef = useRef<string | null>(null);
  const loadedSignatureRef = useRef<string | null>(null);
  const inFlightSignatureRef = useRef<string | null>(null);
  const userPausedRef = useRef(false);

  const playIfAllowed = useCallback(() => {
    if (!userPausedRef.current) {
      engine.play();
    }
  }, [engine]);

  const loadCurrentLiveTrack = useCallback(
    async (track: Track) => {
      const live = timelineLiveRef.current;
      if (!live || playerStateRef.current.mode !== 'LIVE') {
        return;
      }

      const signature = trackPlaybackSignature(track);
      if (inFlightSignatureRef.current === signature) {
        return;
      }

      inFlightSignatureRef.current = signature;
      setPlaybackError(null);

      try {
        const playback = await resolveTrackPlayback(track);
        const latestLive = timelineLiveRef.current;

        if (inFlightSignatureRef.current !== signature || playerStateRef.current.mode !== 'LIVE') {
          return;
        }

        loadedTrackIdRef.current = track.trackId;
        loadedSignatureRef.current = trackPlaybackSignature(track);

        engine.load(
          {
            url: playback.audioUrl,
            trackId: track.trackId,
            title: track.title,
            artist: track.artist,
            durationMs: track.durationMs,
          },
          latestLive ? latestLive.offsetMs / 1000 : 0,
        );

        void resolveTrackCoverUrl(track).then((coverUrl) => {
          if (coverUrl) {
            engine.updateTrackCover(track.trackId, coverUrl);
          }
        });

        playIfAllowed();
      } catch (error) {
        if (inFlightSignatureRef.current === signature) {
          setPlaybackError(
            error instanceof Error ? error.message : 'Unable to resolve live audio.',
          );
        }
      } finally {
        if (inFlightSignatureRef.current === signature) {
          inFlightSignatureRef.current = null;
        }
      }
    },
    [engine, playIfAllowed],
  );

  useEffect(() => {
    if (playerState.mode !== 'LIVE') {
      return;
    }

    const track = currentTrackRef.current;
    const live = timelineLiveRef.current;

    if (!track || !live || loadedSignatureRef.current === trackPlaybackSignature(track)) {
      return;
    }

    loadCurrentLiveTrack(track);
  }, [
    loadCurrentLiveTrack,
    playerState.mode,
    timeline.liveState?.trackId,
    timeline.currentTrack,
    retryNonce,
  ]);

  useEffect(() => {
    if (playerState.mode !== 'LIVE') {
      return;
    }

    const track = currentTrackRef.current;
    if (!track || loadedSignatureRef.current === trackPlaybackSignature(track)) {
      return;
    }

    const timer = window.setInterval(() => {
      if (loadedSignatureRef.current !== trackPlaybackSignature(track)) {
        setRetryNonce((value) => value + 1);
      }
    }, RETRY_DELAY_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [playerState.mode, timeline.currentTrack, timeline.liveState?.trackId]);

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
  }, [engine, playerState.mode, timeline.liveState?.trackId]);

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
      setPlaybackError(null);
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
    inFlightSignatureRef.current = null;
    setPlaybackError(null);
    engine.returnToLive();
    setRetryNonce((value) => value + 1);
  }, [engine]);

  const retry = useCallback(() => {
    loadedTrackIdRef.current = null;
    loadedSignatureRef.current = null;
    setPlaybackError(null);
    setRetryNonce((value) => value + 1);
  }, []);

  return {
    timeline,
    playerState,
    playbackError,
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
