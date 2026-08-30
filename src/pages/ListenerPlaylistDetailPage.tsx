/* ============================================================
 * NodeFM Station — Listener Playlist Detail Page
 *
 * Playback/detail view for a published listener-owned playlist.
 * Missing canonical Station Tracks are shown honestly and skipped
 * during personal playlist playback; historical versions remain
 * immutable.
 * ============================================================ */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { PageShell } from '../components/PageShell';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { useAuth } from '../app/providers/authContext';
import { useStation } from '../features/station';
import { useLiveRadioPlayerContext } from '../features/radio/player';
import { formatDurationMs } from '../utils/duration';
import { TrackDetailModal } from '../features/tracks';
import type { Track } from '../types/domain';
import {
  loadListenerPlaylistDetail,
  resolveListenerPlaylistAudio,
  type ListenerPlaylistDetailResult,
} from '../features/listener-playlists/services/listenerPlaylistDetailService';
import { PaginationControls, paginateItems, usePagination } from '../features/pagination';

export default function ListenerPlaylistDetailPage() {
  const { playlistId } = useParams<{ playlistId: string }>();
  const { ownerName } = useAuth();
  const { publisherName: stationPublisherName, loading: stationLoading } = useStation();
  const { playerState, playPlaylist, togglePlayPause, playNext, playPrevious } =
    useLiveRadioPlayerContext();

  const [result, setResult] = useState<ListenerPlaylistDetailResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolvingAudio, setResolvingAudio] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [detailTrack, setDetailTrack] = useState<Track | null>(null);

  const load = useCallback(async (listenerName: string, stationName: string, id: string) => {
    setLoading(true);
    setError(null);
    setResult(null);
    setStartError(null);

    try {
      setResult(await loadListenerPlaylistDetail(listenerName, stationName, id));
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : 'Failed to load listener playlist.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (stationLoading) return;

    if (!ownerName || !stationPublisherName || !playlistId) {
      setLoading(false);
      setError('A registered Qortium name and station publisher are required.');
      return;
    }

    load(ownerName, stationPublisherName, playlistId);
  }, [load, ownerName, playlistId, stationLoading, stationPublisherName]);

  const startPlayback = useCallback(
    async (shuffle: boolean) => {
      if (result?.status !== 'ready') return;

      setResolvingAudio(true);
      setStartError(null);

      const resolution = await resolveListenerPlaylistAudio(result.detail.tracks);
      setResolvingAudio(false);

      if (resolution.tracks.length === 0) {
        setStartError('No available tracks in this playlist.');
        return;
      }

      playPlaylist(resolution.tracks, {
        startIndex: 0,
        autoplay: true,
        shuffle,
        loop: false,
      });
    },
    [playPlaylist, result],
  );

  const readyDetail = result?.status === 'ready' ? result.detail : undefined;
  const readyTracks = readyDetail?.tracks ?? [];
  const pagination = usePagination(readyTracks.length);
  const pageTracks = paginateItems(readyTracks, pagination.pageIndex, pagination.pageSize);

  if (loading || (stationLoading && !result && !error)) {
    return (
      <PageShell title="Listener Playlist">
        <LoadingState message="Loading playlist…" />
      </PageShell>
    );
  }

  if (error) {
    return (
      <PageShell title="Listener Playlist">
        <ErrorState message="Failed to load listener playlist." detail={error} />
      </PageShell>
    );
  }

  if (!result) {
    return (
      <PageShell title="Listener Playlist">
        <ErrorState message="Listener playlist is unavailable." />
      </PageShell>
    );
  }

  if (result.status === 'not-found' || result.status === 'version-missing') {
    return (
      <PageShell title="Listener Playlist">
        <ErrorState message="Playlist is unavailable." detail={result.message} />
      </PageShell>
    );
  }

  if (result.status === 'version-malformed') {
    return (
      <PageShell title="Listener Playlist">
        <ErrorState message="Playlist version is malformed." detail={result.message} />
      </PageShell>
    );
  }

  if (result.status === 'tracks-unavailable') {
    return (
      <PageShell title="Listener Playlist">
        <div className="listener-playlist-detail">
          <div className="listener-playlist-detail__header">
            <div className="listener-playlist-detail__info">
              <h2>Playlist Version</h2>
              <p className="listener-playlist-detail__meta">
                {result.version.tracks.length} tracks ·{' '}
                {formatDurationMs(result.version.totalDurationMs)}
              </p>
              <p className="listener-playlist-detail__owner">by {ownerName}</p>
            </div>
          </div>
          <p className="listener-playlist-detail__warning">
            {result.failedTrackIds.length} track
            {result.failedTrackIds.length === 1 ? '' : 's'} unavailable.
          </p>
          <ol className="playlist-detail__track-list">
            {result.version.tracks.map((track, index) => (
              <li key={`${track.trackId}-${index}`} className="playlist-detail__track">
                <span className="playlist-detail__track-index">{index + 1}</span>
                <span className="playlist-detail__track-title">
                  {result.failedTrackIds.includes(track.trackId)
                    ? 'Track unavailable'
                    : track.trackId}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </PageShell>
    );
  }

  const { playlist, version, tracks } = result.detail;
  const unavailable: string[] = [];

  return (
    <PageShell title={playlist.title}>
      <div className="listener-playlist-detail">
        <div className="listener-playlist-detail__header">
          <div className="listener-playlist-detail__info">
            <h2>{playlist.title}</h2>
            {playlist.description && <p>{playlist.description}</p>}
            <p className="listener-playlist-detail__meta">
              {version.tracks.length} tracks · {formatDurationMs(version.totalDurationMs)}
            </p>
            <p className="listener-playlist-detail__owner">by {ownerName}</p>
          </div>
        </div>

        <section className="playlist-controls">
          <button
            className="button button--primary"
            type="button"
            onClick={() => startPlayback(false)}
            disabled={resolvingAudio}
          >
            {resolvingAudio ? 'Preparing audio…' : 'Play'}
          </button>
          <button
            className="button button--secondary"
            type="button"
            onClick={() => startPlayback(true)}
            disabled={resolvingAudio}
          >
            Shuffle Play
          </button>
          {playerState.mode === 'PLAYLIST' && (
            <>
              <button
                className="button button--secondary"
                type="button"
                onClick={togglePlayPause}
                disabled={!playerState.currentTrack}
              >
                {playerState.playbackState === 'playing' ? 'Pause' : 'Play'}
              </button>
              <button
                className="button button--secondary"
                type="button"
                onClick={playPrevious}
                disabled={!playerState.playlistQueue}
              >
                Previous
              </button>
              <button
                className="button button--secondary"
                type="button"
                onClick={playNext}
                disabled={!playerState.playlistQueue}
              >
                Next
              </button>
            </>
          )}
          {startError && <p className="form-error">{startError}</p>}
          {playerState.error && <p className="form-error">{playerState.error}</p>}
        </section>

        <section className="playlist-detail__tracks">
          <h3>Tracks</h3>
          {unavailable.length > 0 ? (
            <p className="listener-playlist-detail__warning">
              {unavailable.length} track{unavailable.length === 1 ? '' : 's'} unavailable. Playback
              will skip unavailable tracks.
            </p>
          ) : null}
          <ol className="playlist-detail__track-list">
            {pageTracks.map((entry, index) => {
              const trackIndex = pagination.pageIndex * pagination.pageSize + index;
              const isUnavailable = unavailable.includes(entry.track.trackId);

              return (
                <li
                  key={`${entry.track.trackId}-${trackIndex}`}
                  className={`playlist-detail__track${
                    entry.track.trackId === playerState.currentTrack?.trackId
                      ? ' playlist-detail__track--playing'
                      : ''
                  }`}
                >
                  <span className="playlist-detail__track-index">{trackIndex + 1}</span>
                  <span className="playlist-detail__track-title">
                    {isUnavailable
                      ? 'Track unavailable'
                      : `${entry.track.title}${entry.track.artist ? ` — ${entry.track.artist}` : ''}`}
                  </span>
                  <span className="playlist-detail__track-duration">
                    {isUnavailable ? '—' : formatDurationMs(entry.track.durationMs)}
                  </span>
                  {!isUnavailable && (
                    <button
                      className="button button--secondary playlist-detail__track-info"
                      type="button"
                      aria-label={`${entry.track.title} track details`}
                      onClick={() => setDetailTrack(entry.track)}
                    >
                      ℹ
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
          {tracks.length > 0 ? (
            <PaginationControls
              totalItems={tracks.length}
              pageIndex={pagination.pageIndex}
              pageSize={pagination.pageSize}
              onPageChange={pagination.setPageIndex}
              onPageSizeChange={pagination.setPageSize}
            />
          ) : null}
        </section>
        {detailTrack && (
          <TrackDetailModal track={detailTrack} onClose={() => setDetailTrack(null)} />
        )}
      </div>
    </PageShell>
  );
}
