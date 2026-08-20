/* ============================================================
 * NodeFM Station — Public Layout
 *
 * Public-facing layout with navigation header and player bar.
 * Shows an Admin link when the authenticated user is the
 * station owner (Phase 2 bootstrap or Phase 3 station config).
 * AdminGuard remains the actual authorization gate.
 * ============================================================ */

import { Link, Outlet, useLocation } from 'react-router-dom';
import { useStation } from '../features/station';
import { useLiveRadioPlayerContext } from '../features/radio/player';
import { formatDurationMs } from '../utils/duration';

const PUBLIC_NAV = [
  { to: '/', label: 'Radio' },
  { to: '/playlists', label: 'Playlists' },
  { to: '/submit-music', label: 'Submit Music' },
  { to: '/about', label: 'About' },
] as const;

export function Layout() {
  const location = useLocation();
  const { isOwner, station } = useStation();
  const {
    playerState,
    timeline,
    togglePlayPause,
    playNext,
    playPrevious,
    togglePlaylistShuffle,
    togglePlaylistLoop,
    setVolume,
    toggleMute,
    returnToLive,
    playbackError,
  } = useLiveRadioPlayerContext();

  const liveState = timeline.liveState;
  const currentTrack = playerState.currentTrack;
  const isPlaying = playerState.playbackState === 'playing';
  const progressMs = Math.max(0, Math.round(playerState.currentOffsetSec * 1000));
  const hasNoStation = timeline.stationLoaded && !station && !timeline.stationLoading;
  const hasStationError = timeline.stationError !== null;
  const durationMs =
    currentTrack?.durationMs ??
    (liveState?.trackEndUtcMs !== undefined && liveState?.trackStartUtcMs !== undefined
      ? liveState.trackEndUtcMs - liveState.trackStartUtcMs
      : 0);

  return (
    <div className="layout layout--public">
      <header className="layout__header">
        <div className="layout__brand">
          <Link to="/" className="layout__brand-link">
            NodeFM
          </Link>
        </div>
        <nav className="layout__nav" aria-label="Main navigation">
          {PUBLIC_NAV.map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              className={`layout__nav-link${location.pathname === to ? ' layout__nav-link--active' : ''}`}
            >
              {label}
            </Link>
          ))}
          {isOwner && (
            <Link
              to="/admin"
              className={`layout__nav-link${location.pathname.startsWith('/admin') ? ' layout__nav-link--active' : ''}`}
            >
              Admin
            </Link>
          )}
        </nav>
      </header>

      <main className="layout__main">
        <Outlet />
      </main>

      <footer className="layout__player-bar">
        <div className="player-bar__info">
          <span className="player-bar__status">
            {playerState.mode === 'PLAYLIST' ? 'PLAYLIST' : 'LIVE'}
          </span>
          <span className="player-bar__track">
            {currentTrack
              ? `${currentTrack.title}${currentTrack.artist ? ` — ${currentTrack.artist}` : ''}`
              : hasStationError
                ? 'Station data unavailable'
                : timeline.dataError
                  ? 'Live radio data unavailable'
                  : hasNoStation
                    ? 'No station configured'
                    : timeline.dataLoading
                      ? 'Loading live radio…'
                      : '—'}
          </span>
          {durationMs > 0 && (
            <span className="player-bar__time">
              {formatDurationMs(progressMs)} / {formatDurationMs(durationMs)}
            </span>
          )}
        </div>
        <div className="player-bar__controls">
          {playerState.mode === 'PLAYLIST' && (
            <>
              <button
                className="player-bar__btn"
                type="button"
                aria-label="Previous track"
                onClick={playPrevious}
                disabled={!playerState.playlistQueue}
              >
                ⏮
              </button>
              <button
                className="player-bar__btn"
                type="button"
                aria-label="Next track"
                onClick={playNext}
                disabled={!playerState.playlistQueue}
              >
                ⏭
              </button>
              <button
                className={`player-bar__btn${playerState.playlistQueue?.shuffleEnabled ? ' player-bar__btn--active' : ''}`}
                type="button"
                aria-label="Toggle shuffle"
                onClick={togglePlaylistShuffle}
                disabled={!playerState.playlistQueue}
              >
                🔀
              </button>
              <button
                className={`player-bar__btn${playerState.playlistQueue?.loopEnabled ? ' player-bar__btn--active' : ''}`}
                type="button"
                aria-label="Toggle loop"
                onClick={togglePlaylistLoop}
                disabled={!playerState.playlistQueue}
              >
                🔁
              </button>
              <button className="player-bar__btn" type="button" onClick={returnToLive}>
                Return to Live
              </button>
            </>
          )}
          <button
            className="player-bar__btn"
            type="button"
            aria-label={isPlaying ? 'Pause' : 'Play'}
            onClick={togglePlayPause}
            disabled={!currentTrack || playbackError !== null}
            title={playbackError ?? undefined}
          >
            {isPlaying ? '❚❚' : '▶'}
          </button>
          <button
            className="player-bar__btn"
            type="button"
            aria-label={playerState.muted ? 'Unmute' : 'Mute'}
            onClick={toggleMute}
          >
            {playerState.muted ? '🔇' : '🔊'}
          </button>
          <input
            className="player-bar__volume"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={playerState.muted ? 0 : playerState.volume}
            aria-label="Volume"
            onChange={(event) => setVolume(Number(event.target.value))}
          />
        </div>
      </footer>
    </div>
  );
}
