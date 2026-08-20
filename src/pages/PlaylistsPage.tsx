/* ============================================================
 * NodeFM Station — Playlists Page (Public)
 *
 * Read-only public station playlist browser for the current
 * phase. Playlist playback is intentionally not included here.
 * ============================================================ */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageShell } from '../components/PageShell';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { useStation } from '../features/station';
import { ShareModal } from '../features/sharing';
import type { ShareTargetInput } from '../features/sharing';
import { formatDurationMs } from '../utils/duration';
import {
  loadPublicPlaylists,
  type PublicPlaylist,
} from '../features/playlists/services/publicPlaylistService';

export default function PlaylistsPage() {
  const { publisherName, loading: stationLoading } = useStation();
  const [playlists, setPlaylists] = useState<PublicPlaylist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [incomplete, setIncomplete] = useState(false);
  const [shareTarget, setShareTarget] = useState<ShareTargetInput | null>(null);

  const load = useCallback(async (name: string) => {
    setLoading(true);
    setError(null);
    setIncomplete(false);

    try {
      const result = await loadPublicPlaylists(name);
      setPlaylists(result.playlists);
      setIncomplete(result.status === 'incomplete');
    } catch (err) {
      setPlaylists([]);
      setIncomplete(false);
      setError(err instanceof Error ? err.message : 'Failed to load public playlists.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (stationLoading) {
      return;
    }

    if (!publisherName) {
      setLoading(false);
      setPlaylists([]);
      setError(null);
      setIncomplete(false);
      return;
    }

    load(publisherName);
  }, [load, publisherName, stationLoading]);

  return (
    <PageShell title="Playlists">
      <div className="playlists-page">
        {loading ? (
          <LoadingState message="Loading public playlists…" />
        ) : error ? (
          <ErrorState
            message="Failed to load public playlists."
            detail={error}
            onRetry={() => publisherName && load(publisherName)}
          />
        ) : playlists.length === 0 && incomplete ? (
          <p className="playlists-page__placeholder">
            Some public station playlists could not be loaded. Please retry.
          </p>
        ) : playlists.length === 0 ? (
          <p className="playlists-page__placeholder">
            No public station playlists have been published yet.
          </p>
        ) : (
          <>
            {incomplete && (
              <p className="form-error">
                Some public station playlists could not be loaded. The list below may be incomplete.
              </p>
            )}
            <ul className="public-playlists__list">
              {playlists.map((playlist) => (
                <li
                  key={`${playlist.publisherName}-${playlist.playlistId}`}
                  className={`public-playlist-card${
                    playlist.versionStatus === 'ready' ? '' : ' public-playlist-card--unavailable'
                  }`}
                >
                  {playlist.coverUrl ? (
                    <img className="public-playlist-card__cover" src={playlist.coverUrl} alt="" />
                  ) : (
                    <div className="public-playlist-card__cover-placeholder" aria-hidden="true">
                      <span className="signal-cover__core" />
                    </div>
                  )}
                  <div className="public-playlist-card__info">
                    <h3 className="public-playlist-card__title">{playlist.title}</h3>
                    {playlist.description && (
                      <p className="public-playlist-card__description">{playlist.description}</p>
                    )}
                    <span className="public-playlist-card__visibility">
                      Public station playlist
                    </span>
                    <span className="public-playlist-card__meta">
                      {playlist.versionStatus === 'ready'
                        ? `${playlist.trackCount} tracks · ${formatDurationMs(playlist.totalDurationMs)}`
                        : playlist.versionStatus === 'missing'
                          ? 'Published version unavailable'
                          : 'Published version is malformed'}
                    </span>
                  </div>
                  <div className="public-playlist-card__actions">
                    <Link
                      className="button button--primary"
                      to={`/playlists/${playlist.playlistId}`}
                    >
                      Open
                    </Link>
                    <button
                      className="button button--secondary"
                      type="button"
                      onClick={() =>
                        setShareTarget({
                          kind: 'playlist',
                          playlistId: playlist.playlistId,
                        })
                      }
                    >
                      Share
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
        {shareTarget && <ShareModal target={shareTarget} onClose={() => setShareTarget(null)} />}
      </div>
    </PageShell>
  );
}
