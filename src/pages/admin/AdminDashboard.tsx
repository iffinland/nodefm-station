/* ============================================================
 * NodeFM Station — Admin Dashboard
 *
 * Station overview for the owner. On Air and Next Program come
 * from the existing live timeline; library, playlist, and pending
 * submission counts come from their account-scoped stores.
 * ============================================================ */

import { Link } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';
import { useLiveRadioPlayerContext } from '../../features/radio/player';
import { useStation } from '../../features/station';
import { useLibrary } from '../../hooks/useLibrary';
import { usePlaylists } from '../../hooks/usePlaylists';
import { useListenerSubmissions } from '../../features/listener-submissions';
import {
  DASHBOARD_QUICK_ACTIONS,
  getDashboardQuickActionHref,
  getPendingSubmissionCount,
  getPublishedPlaylistCount,
  resolveDashboardCount,
} from '../../features/admin-dashboard';
import { isValidIanaTimeZone } from '../../features/scheduling/services/timezone';

export default function AdminDashboard() {
  const { timeline } = useLiveRadioPlayerContext();
  const { station } = useStation();
  const {
    tracks,
    loaded: libraryLoaded,
    loading: libraryLoading,
    error: libraryError,
    incomplete: libraryIncomplete,
  } = useLibrary();
  const {
    playlists,
    loaded: playlistsLoaded,
    loading: playlistsLoading,
    error: playlistsError,
    incomplete: playlistsIncomplete,
  } = usePlaylists();
  const {
    reviews,
    loaded: submissionsLoaded,
    loading: submissionsLoading,
    error: submissionsError,
    incomplete: submissionsIncomplete,
  } = useListenerSubmissions();

  const liveState = timeline.liveState;
  const nextEvent = timeline.scheduleEvents
    .filter((event) => Date.parse(event.startUtc) > timeline.nowUtcMs)
    .sort((left, right) => Date.parse(left.startUtc) - Date.parse(right.startUtc))[0];
  const scheduleTimeZone =
    station?.timezone && isValidIanaTimeZone(station.timezone) ? station.timezone : 'UTC';

  const libraryCount = resolveDashboardCount(
    {
      loaded: libraryLoaded,
      loading: libraryLoading,
      error: libraryError,
      incomplete: libraryIncomplete,
      count: tracks.length,
    },
    tracks.length === 0 ? 'No tracks yet' : 'Station library tracks',
  );
  const publishedPlaylistCount = resolveDashboardCount(
    {
      loaded: playlistsLoaded,
      loading: playlistsLoading,
      error: playlistsError,
      incomplete: playlistsIncomplete,
      count: getPublishedPlaylistCount(playlists),
    },
    getPublishedPlaylistCount(playlists) === 0
      ? 'No published playlists yet'
      : 'Logical playlists with a published version',
  );
  const pendingSubmissionCount = resolveDashboardCount(
    {
      loaded: submissionsLoaded,
      loading: submissionsLoading,
      error: submissionsError,
      incomplete: submissionsIncomplete,
      count: getPendingSubmissionCount(reviews),
    },
    getPendingSubmissionCount(reviews) === 0
      ? 'No pending submissions'
      : 'Awaiting owner moderation',
  );

  const renderCount = (resolution: ReturnType<typeof resolveDashboardCount>) => {
    if (resolution.status === 'loading') {
      return (
        <>
          <p className="admin-dashboard__value">…</p>
          <p className="admin-dashboard__hint">{resolution.hint}</p>
        </>
      );
    }

    if (resolution.status === 'error') {
      return (
        <>
          <p className="admin-dashboard__value">—</p>
          <p className="admin-dashboard__hint">{resolution.hint}</p>
        </>
      );
    }

    return (
      <>
        <p className="admin-dashboard__value">{resolution.value ?? 0}</p>
        <p className="admin-dashboard__hint">{resolution.hint}</p>
      </>
    );
  };

  return (
    <PageShell title={station?.name ?? 'Dashboard'}>
      <div className="admin-dashboard">
        <div className="admin-dashboard__grid">
          <div className="admin-dashboard__card">
            <h3>On Air</h3>
            <p className="admin-dashboard__value">{timeline.currentTrack?.title ?? '—'}</p>
            <p className="admin-dashboard__hint">
              {liveState?.programTitle ??
                (liveState?.mode === 'default-rotation'
                  ? 'Default rotation active'
                  : 'Live timeline unavailable')}
            </p>
          </div>
          <div className="admin-dashboard__card">
            <h3>Next Program</h3>
            <p className="admin-dashboard__value">{nextEvent?.title ?? '—'}</p>
            <p className="admin-dashboard__hint">
              {nextEvent
                ? new Intl.DateTimeFormat([], {
                    timeZone: scheduleTimeZone,
                    hour: '2-digit',
                    minute: '2-digit',
                  }).format(Date.parse(nextEvent.startUtc))
                : 'No upcoming scheduled events'}
            </p>
          </div>
          <div className="admin-dashboard__card">
            <h3>Tracks in Library</h3>
            {renderCount(libraryCount)}
          </div>
          <div className="admin-dashboard__card">
            <h3>Published Playlists</h3>
            {renderCount(publishedPlaylistCount)}
          </div>
          <div className="admin-dashboard__card">
            <h3>Pending Listener Submissions</h3>
            {renderCount(pendingSubmissionCount)}
          </div>
        </div>

        <div className="admin-dashboard__actions">
          <h3>Quick Actions</h3>
          <div className="admin-dashboard__action-list">
            {DASHBOARD_QUICK_ACTIONS.map((action) => (
              <Link
                key={action.id}
                to={getDashboardQuickActionHref(action)}
                className="button button--secondary admin-dashboard__action-link"
              >
                {action.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </PageShell>
  );
}
