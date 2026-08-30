/* ============================================================
 * NodeFM Station — My Playlists Page
 *
 * Listener-owned playlist browser. A registered Qortium name is
 * mandatory; the page deliberately shows an honest blocked state
 * instead of creating unnamed drafts.
 * ============================================================ */

import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PageShell } from '../components/PageShell';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { useAuth } from '../app/providers/authContext';
import { useListenerPlaylists } from '../features/listener-playlists';
import { PaginationControls, paginateItems, usePagination } from '../features/pagination';
import { formatDurationMs } from '../utils/duration';

type ListenerPlaylistCardItem = {
  key: string;
  playlistId: string;
  title: string;
  description?: string;
  trackCount: number;
  totalDurationMs: number;
  updatedAt: string;
  state: 'Draft' | 'Published';
  latestVersionId?: string;
};

export default function MyPlaylistsPage() {
  const navigate = useNavigate();
  const { auth, ownerName } = useAuth();
  const { playlists, loaded, loading, error, incomplete, getDrafts, getDraft, getLatestVersion } =
    useListenerPlaylists();

  const items = useMemo(() => {
    const map = new Map<string, ListenerPlaylistCardItem>();

    for (const playlist of playlists) {
      const latest = getLatestVersion(playlist.playlistId);
      map.set(playlist.playlistId, {
        key: playlist.playlistId,
        playlistId: playlist.playlistId,
        title: playlist.title,
        description: playlist.description,
        trackCount: latest?.tracks.length ?? 0,
        totalDurationMs: latest?.totalDurationMs ?? 0,
        updatedAt: playlist.updatedAt,
        state: 'Published',
        latestVersionId: latest?.versionId,
      });
    }

    // Unpublished drafts that do not yet have a logical QDN playlist.
    for (const draft of getDrafts()) {
      if (map.has(draft.playlistId)) continue;

      map.set(draft.playlistId, {
        key: draft.playlistId,
        playlistId: draft.playlistId,
        title: draft.title,
        description: draft.description,
        trackCount: draft.entries.length,
        totalDurationMs: draft.entries.reduce((sum, entry) => sum + entry.durationMs, 0),
        updatedAt: draft.updatedAt,
        state: 'Draft',
      });
    }

    for (const playlist of playlists) {
      const draft = getDraft(playlist.playlistId);
      if (draft) {
        map.set(playlist.playlistId, {
          ...map.get(playlist.playlistId)!,
          title: draft.title,
          description: draft.description,
          trackCount: draft.entries.length,
          totalDurationMs: draft.entries.reduce((sum, entry) => sum + entry.durationMs, 0),
          updatedAt: draft.updatedAt,
          state: 'Draft',
        });
      }
    }

    return [...map.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }, [getDraft, getDrafts, getLatestVersion, playlists]);

  const pagination = usePagination(items.length);
  const pageItems = paginateItems(items, pagination.pageIndex, pagination.pageSize);

  if (auth.status === 'loading') {
    return (
      <PageShell title="My Playlists">
        <LoadingState message="Checking Qortium identity…" />
      </PageShell>
    );
  }

  if (!ownerName) {
    return (
      <PageShell title="My Playlists">
        <div className="my-playlists">
          <ErrorState
            message="Registered Name required"
            detail="A registered QDN name is required to create and publish playlists."
          />
        </div>
      </PageShell>
    );
  }

  if (loading && !loaded) {
    return (
      <PageShell title="My Playlists">
        <LoadingState message="Loading your playlists…" />
      </PageShell>
    );
  }

  if (error && !loaded) {
    return (
      <PageShell title="My Playlists">
        <ErrorState
          message="Failed to load your playlists."
          detail={error}
          onRetry={() => navigate(0)}
        />
      </PageShell>
    );
  }

  return (
    <PageShell title="My Playlists">
      <div className="my-playlists">
        <div className="my-playlists__toolbar">
          <button
            className="button button--primary"
            type="button"
            onClick={() => navigate('/my-playlists/new')}
          >
            + Create Playlist
          </button>
          <span className="my-playlists__count">
            {items.length} playlist{items.length === 1 ? '' : 's'}
          </span>
        </div>

        {incomplete && (
          <p className="form-error">
            Some listener playlists could not be fully loaded. The list below may be incomplete.
          </p>
        )}

        {items.length === 0 ? (
          <p className="my-playlists__empty">
            You have no playlists yet. Create one to start building your own station mixes.
          </p>
        ) : (
          <ul className="my-playlists__list">
            {pageItems.map((item) => (
              <li key={item.key} className="my-playlist-card">
                <div className="my-playlist-card__info">
                  <h3>{item.title}</h3>
                  {item.description && <p>{item.description}</p>}
                  <span className="my-playlist-card__meta">
                    {item.trackCount} track{item.trackCount === 1 ? '' : 's'} ·{' '}
                    {formatDurationMs(item.totalDurationMs)}
                  </span>
                  <span
                    className={`my-playlist-card__state my-playlist-card__state--${item.state.toLowerCase()}`}
                  >
                    {item.state}
                  </span>
                  <span className="my-playlist-card__updated">
                    Updated {new Date(item.updatedAt).toLocaleString()}
                  </span>
                </div>
                <div className="my-playlist-card__actions">
                  {item.state === 'Published' && item.latestVersionId ? (
                    <Link
                      className="button button--primary"
                      to={`/my-playlists/${item.playlistId}/play`}
                    >
                      Play
                    </Link>
                  ) : (
                    <button className="button button--primary" type="button" disabled>
                      Play
                    </button>
                  )}
                  <Link
                    className="button button--secondary"
                    to={`/my-playlists/${item.playlistId}`}
                  >
                    Edit
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}

        {items.length > 0 ? (
          <PaginationControls
            totalItems={items.length}
            pageIndex={pagination.pageIndex}
            pageSize={pagination.pageSize}
            onPageChange={pagination.setPageIndex}
            onPageSizeChange={pagination.setPageSize}
          />
        ) : null}
      </div>
    </PageShell>
  );
}
