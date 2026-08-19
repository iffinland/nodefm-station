/* ============================================================
 * NodeFM Station — Public Playlist Detail Page
 *
 * Resolves a public playlist's canonical immutable
 * PlaylistVersion, reconstructs its tracks, and exposes the
 * global AudioEngine's PLAYLIST controls.
 * ============================================================ */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { PageShell } from '../components/PageShell';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { useStation } from '../features/station';
import { useLiveRadioPlayerContext } from '../features/radio/player';
import { formatDurationMs } from '../utils/duration';
import {
  loadPublicPlaylistDetail,
  resolvePublicPlaylistAudioTracks,
  type PublicPlaylistDetail,
  type PublicPlaylistDetailResult,
} from '../features/playlists/services/publicPlaylistService';

export default function PlaylistDetailPage() {
  const { playlistId } = useParams<{ playlistId: string }>();
  const { publisherName, loading: stationLoading } = useStation();
  const {
    playerState,
    togglePlayPause,
    playPlaylist,
    playNext,
    playPrevious,
    togglePlaylistShuffle,
    togglePlaylistLoop,
    seek,
    returnToLive,
  } = useLiveRadioPlayerContext();

  const [result, setResult] = useState<PublicPlaylistDetailResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolvingAudio, setResolvingAudio] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const load = useCallback(async (publisher: string, id: string) => {
    setLoading(true);
    setError(null);
    setResult(null);
    setStartError(null);

    try {
      setResult(await loadPublicPlaylistDetail(publisher, id));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load playlist.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (stationLoading) {
      return;
    }

    if (!publisherName || !playlistId) {
      setLoading(false);
      setError('No station publisher is available.');
      return;
    }

    load(publisherName, playlistId);
  }, [load, playlistId, publisherName, stationLoading]);

  const detail: PublicPlaylistDetail | null = result?.status === 'ready' ? result.detail : null;

  const startPlayback = useCallback(
    async (startIndex = 0) => {
      if (!detail) {
        return;
      }

      setResolvingAudio(true);
      setStartError(null);

      const resolution = await resolvePublicPlaylistAudioTracks(detail.tracks);

      setResolvingAudio(false);

      if (resolution.status === 'audio-unavailable') {
        setStartError(resolution.message);
        return;
      }

      playPlaylist(resolution.tracks, {
        startIndex,
        autoplay: true,
        shuffle: false,
        loop: false,
      });
    },
    [detail, playPlaylist],
  );

  const queue = playerState.playlistQueue;
  const currentTrack = playerState.currentTrack;
  const isPlaying = playerState.playbackState === 'playing';
  const durationSec = currentTrack ? Math.max(0, currentTrack.durationMs / 1000) : 0;
  const offsetSec = Math.max(
    0,
    Math.min(playerState.currentOffsetSec, durationSec || playerState.currentOffsetSec),
  );

  if (loading || (stationLoading && !result && !error)) {
    return (
      <PageShell title="Playlist">
        <LoadingState message="Loading playlist…" />
      </PageShell>
    );
  }

  if (error) {
    return (
      <PageShell title="Playlist">
        <ErrorState
          message="Failed to load playlist."
          detail={error}
          onRetry={() => publisherName && playlistId && load(publisherName, playlistId)}
        />
      </PageShell>
    );
  }

  if (!result) {
    return (
      <PageShell title="Playlist">
        <ErrorState message="Playlist is unavailable." />
      </PageShell>
    );
  }

  if (result.status !== 'ready') {
    return (
      <PageShell title="Playlist">
        <ErrorState
          message="Playlist is unavailable."
          detail={result.message}
          onRetry={() => publisherName && playlistId && load(publisherName, playlistId)}
        />
      </PageShell>
    );
  }

  const { playlist, version, tracks } = result.detail;
  const coverUrl =
    playerState.mode === 'PLAYLIST' && currentTrack?.coverUrl
      ? currentTrack.coverUrl
      : (tracks.find((item) => item.coverUrl)?.coverUrl ?? undefined);

  return (
    <PageShell title={playlist.title}>
      <div className="playlist-detail">
        <div className="playlist-detail__header">
          {coverUrl ? (
            <img className="playlist-detail__cover" src={coverUrl} alt="" />
          ) : (
            <div className="playlist-detail__cover-placeholder" aria-hidden="true">
              ♫
            </div>
          )}
          <div className="playlist-detail__info">
            <h2 className="playlist-detail__title">{playlist.title}</h2>
            {playlist.description && (
              <p className="playlist-detail__description">{playlist.description}</p>
            )}
            <p className="playlist-detail__meta">
              {version.tracks.length} tracks · {formatDurationMs(version.totalDurationMs)}
            </p>
            <p className="playlist-detail__publisher">Published by {publisherName}</p>
          </div>
        </div>

        {playerState.mode === 'PLAYLIST' ? (
          <section className="playlist-controls">
            <button className="button button--secondary" type="button" onClick={returnToLive}>
              Return to Live
            </button>
            <button
              className="button button--primary"
              type="button"
              onClick={togglePlayPause}
              disabled={!currentTrack}
            >
              {isPlaying ? 'Pause' : 'Play'}
            </button>
            <button
              className="button button--secondary"
              type="button"
              onClick={playPrevious}
              disabled={!queue}
            >
              Previous
            </button>
            <button
              className="button button--secondary"
              type="button"
              onClick={playNext}
              disabled={!queue}
            >
              Next
            </button>
            <button
              className={`button ${queue?.shuffleEnabled ? 'button--primary' : 'button--secondary'}`}
              type="button"
              onClick={togglePlaylistShuffle}
              disabled={!queue}
            >
              Shuffle {queue?.shuffleEnabled ? 'On' : 'Off'}
            </button>
            <button
              className={`button ${queue?.loopEnabled ? 'button--primary' : 'button--secondary'}`}
              type="button"
              onClick={togglePlaylistLoop}
              disabled={!queue}
            >
              Loop {queue?.loopEnabled ? 'On' : 'Off'}
            </button>
            {currentTrack && (
              <div className="playlist-controls__seek">
                <span>{formatDurationMs(Math.round(offsetSec * 1000))}</span>
                <input
                  type="range"
                  min="0"
                  max={Math.max(durationSec, 1)}
                  step="0.1"
                  value={offsetSec}
                  aria-label="Seek"
                  onChange={(event) => seek(Number(event.target.value))}
                />
                <span>{formatDurationMs(currentTrack.durationMs)}</span>
              </div>
            )}
            {startError && <p className="playlist-detail__error">{startError}</p>}
            {playerState.error && <p className="playlist-detail__error">{playerState.error}</p>}
          </section>
        ) : (
          <section className="playlist-controls">
            <button
              className="button button--primary"
              type="button"
              onClick={() => startPlayback(0)}
              disabled={resolvingAudio}
            >
              {resolvingAudio ? 'Preparing audio…' : 'Listen to Playlist'}
            </button>
            {startError && <p className="playlist-detail__error">{startError}</p>}
          </section>
        )}

        <section className="playlist-detail__tracks">
          <h3>Tracks</h3>
          <ol className="playlist-detail__track-list">
            {tracks.map((entry, index) => (
              <li key={`${entry.track.trackId}-${index}`} className="playlist-detail__track">
                <span className="playlist-detail__track-index">{index + 1}</span>
                <span className="playlist-detail__track-title">
                  {entry.track.title}
                  {entry.track.artist ? ` — ${entry.track.artist}` : ''}
                </span>
                <span className="playlist-detail__track-duration">
                  {formatDurationMs(entry.track.durationMs)}
                </span>
                <button
                  className="button button--secondary"
                  type="button"
                  onClick={() => startPlayback(index)}
                  disabled={resolvingAudio}
                >
                  Play
                </button>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </PageShell>
  );
}
