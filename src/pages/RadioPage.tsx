/* ============================================================
 * NodeFM Station — Radio Page (Public)
 *
 * The primary listener experience.
 * Phase 1: Shell only. Live player and timeline come in Phase 3.
 * ============================================================ */

import { PageShell } from '../components/PageShell';
import { useLiveRadioPlayerContext } from '../features/radio/player';
import { useStation } from '../features/station';
import { formatDurationMs } from '../utils/duration';

export default function RadioPage() {
  const { playerState, timeline, playbackError, retry } = useLiveRadioPlayerContext();
  const { station, loading: stationLoading, refresh: refreshStation } = useStation();
  const liveState = timeline.liveState;
  const currentTrack = timeline.currentTrack;
  const hasNoStation = timeline.stationLoaded && !station && !timeline.stationLoading;

  return (
    <PageShell title={station?.name ?? 'NodeFM Radio'}>
      <div className="radio-page">
        {/* Now Playing Section */}
        <section className="radio-page__now-playing">
          <div className="now-playing__cover">
            {playerState.currentTrack?.coverUrl ? (
              <img
                className="now-playing__cover-image"
                src={playerState.currentTrack.coverUrl}
                alt=""
              />
            ) : (
              <div className="now-playing__cover-placeholder" aria-hidden="true">
                ♫
              </div>
            )}
          </div>
          <div className="now-playing__info">
            <h2 className="now-playing__title">{currentTrack?.title ?? '—'}</h2>
            <p className="now-playing__artist">
              {currentTrack?.artist ?? (stationLoading ? 'Loading station…' : 'No track playing')}
            </p>
            {liveState?.programTitle && (
              <p className="now-playing__program">{liveState.programTitle}</p>
            )}
            <span className="now-playing__live-badge">
              {liveState?.mode === 'scheduled' ? 'SCHEDULED' : 'LIVE'}
            </span>
            {currentTrack && (
              <p className="now-playing__track-time">
                {formatDurationMs(currentTrack.durationMs)} track duration
              </p>
            )}
            {playbackError && (
              <p className="now-playing__error">
                {playbackError}{' '}
                <button className="button button--secondary" type="button" onClick={retry}>
                  Retry
                </button>
              </p>
            )}
            {timeline.stationError && (
              <p className="now-playing__error">
                {timeline.stationError}{' '}
                <button className="button button--secondary" type="button" onClick={refreshStation}>
                  Retry
                </button>
              </p>
            )}
            {timeline.dataError && (
              <p className="now-playing__error">
                {timeline.dataError}{' '}
                <button
                  className="button button--secondary"
                  type="button"
                  onClick={timeline.refreshData}
                >
                  Retry
                </button>
              </p>
            )}
            {hasNoStation && (
              <p className="radio-page__placeholder">No station program is configured yet.</p>
            )}
          </div>
        </section>

        {/* Upcoming Section */}
        <section className="radio-page__upcoming">
          <h3>Coming Up</h3>
          {timeline.dataLoading ? (
            <p className="radio-page__placeholder">Loading upcoming tracks…</p>
          ) : timeline.upcoming.length > 0 ? (
            <ol className="radio-page__upcoming-list">
              {timeline.upcoming.map((item, index) => (
                <li key={`${item.expectedStartUtcMs}-${item.trackId}-${index}`}>
                  <span className="radio-page__upcoming-track">
                    {item.title ?? item.trackId}
                    {item.artist ? ` — ${item.artist}` : ''}
                  </span>
                  <span className="radio-page__upcoming-time">
                    {new Date(item.expectedStartUtcMs).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="radio-page__placeholder">No upcoming tracks available.</p>
          )}
        </section>

        {/* Schedule Section */}
        <section className="radio-page__schedule">
          <h3>Today's Schedule</h3>
          <p className="radio-page__placeholder">Program schedule will appear here in Phase 4.</p>
        </section>
      </div>
    </PageShell>
  );
}
