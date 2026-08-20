/* ============================================================
 * NodeFM Station — Radio Page (Public)
 *
 * The primary listener experience.
 * Phase 1: Shell only. Live player and timeline come in Phase 3.
 * ============================================================ */

import { PageShell } from '../components/PageShell';
import { useLiveRadioPlayerContext } from '../features/radio/player';
import { useStation } from '../features/station';
import { useAuth } from '../app/providers/authContext';
import { useLikes } from '../features/likes/useLikes';
import { formatDurationMs } from '../utils/duration';
import { isValidIanaTimeZone } from '../features/scheduling/services/timezone';
import { useState } from 'react';
import { MessageOwnerModal } from '../features/messaging';
import { TipOwnerModal } from '../features/tips';
import { ShareModal } from '../features/sharing';
import { StationNotices } from '../features/notices/components';

export default function RadioPage() {
  const { playerState, timeline, playbackError, retry } = useLiveRadioPlayerContext();
  const { station, loading: stationLoading, refresh: refreshStation } = useStation();
  const { auth } = useAuth();
  const liveState = timeline.liveState;
  const currentTrack = timeline.currentTrack;
  const currentTrackId = currentTrack?.trackId ?? '';
  const {
    isLiked,
    getLikeCount,
    toggleLike,
    loading: likesLoading,
    error: likesLoadError,
    incomplete: likesIncomplete,
  } = useLikes(currentTrackId ? [currentTrackId] : []);
  const [likeError, setLikeError] = useState<string | null>(null);
  const [messageOpen, setMessageOpen] = useState(false);
  const [tipOpen, setTipOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const hasNoStation = timeline.stationLoaded && !station && !timeline.stationLoading;
  const scheduleTimeZone =
    station?.timezone && isValidIanaTimeZone(station.timezone) ? station.timezone : 'UTC';

  const handleLike = async () => {
    if (!currentTrackId) {
      return;
    }

    if (auth.status !== 'authenticated') {
      setLikeError('Select a Qortium account to Like tracks.');
      return;
    }

    try {
      setLikeError(null);
      await toggleLike(currentTrackId);
    } catch (error) {
      setLikeError(error instanceof Error ? error.message : 'Failed to update Like.');
    }
  };

  return (
    <PageShell title={station?.name ?? 'NodeFM Radio'}>
      <div className="radio-page">
        {/* Now Playing Section */}
        <section className="radio-page__hero" aria-label="Now playing">
          <div className="radio-page__hero-signal" aria-hidden="true" />
          <div className="radio-page__now-playing">
            <div className="now-playing__cover">
              {playerState.currentTrack?.coverUrl ? (
                <img
                  className="now-playing__cover-image"
                  src={playerState.currentTrack.coverUrl}
                  alt=""
                />
              ) : (
                <div className="now-playing__cover-placeholder" aria-hidden="true">
                  <span className="signal-cover__core signal-cover__core--lg" />
                </div>
              )}
            </div>
            <div className="now-playing__info">
              <div className="now-playing__status-row">
                <span
                  className={`now-playing__live-badge${
                    liveState?.mode === 'scheduled' ? ' now-playing__live-badge--scheduled' : ''
                  }`}
                >
                  {liveState?.mode === 'scheduled' ? 'SCHEDULED' : 'AutoDJ-LIVE'}
                </span>
              </div>
              <h2 className="now-playing__title">{currentTrack?.title ?? '—'}</h2>
              <p className="now-playing__artist">
                {currentTrack?.artist ?? (stationLoading ? 'Loading station…' : 'No track playing')}
              </p>
              {liveState?.programTitle && (
                <p className="now-playing__program">{liveState.programTitle}</p>
              )}
              {currentTrack && (
                <p className="now-playing__track-time">
                  {formatDurationMs(currentTrack.durationMs)} track duration
                </p>
              )}
              {currentTrack && (
                <div className="now-playing__like">
                  <button
                    className={`button ${
                      isLiked(currentTrack.trackId) ? 'button--liked' : 'button--like'
                    }`}
                    type="button"
                    onClick={handleLike}
                    aria-pressed={isLiked(currentTrack.trackId)}
                    disabled={likesLoading}
                  >
                    <span className="now-playing__like-icon" aria-hidden="true">
                      {isLiked(currentTrack.trackId) ? '♥' : '♡'}
                    </span>
                    <span>{isLiked(currentTrack.trackId) ? 'Liked' : 'Like'}</span>
                    <span className="now-playing__like-count">
                      {getLikeCount(currentTrack.trackId)}
                    </span>
                  </button>
                  {likeError && <p className="now-playing__error">{likeError}</p>}
                  {likesLoadError && (
                    <p className="now-playing__error">Like data unavailable: {likesLoadError}</p>
                  )}
                  {likesIncomplete && (
                    <p className="now-playing__error">
                      Like data is incomplete and may not reflect all Likes.
                    </p>
                  )}
                </div>
              )}
              {station && (
                <div className="now-playing__social-actions">
                  <button
                    className="button button--secondary"
                    type="button"
                    onClick={() => setMessageOpen(true)}
                    title={station.messagingEnabled ? undefined : 'Station messaging is disabled.'}
                  >
                    Message Owner
                  </button>
                  <button
                    className="button button--secondary"
                    type="button"
                    onClick={() => setTipOpen(true)}
                    title={station.tipsEnabled ? undefined : 'Station tips/donations are disabled.'}
                  >
                    Tip Owner
                  </button>
                  <button
                    className="button button--secondary"
                    type="button"
                    onClick={() => setShareOpen(true)}
                  >
                    Share
                  </button>
                </div>
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
                  <button
                    className="button button--secondary"
                    type="button"
                    onClick={refreshStation}
                  >
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
          </div>

          <div className="radio-page__notices">
            <StationNotices nowUtcMs={timeline.nowUtcMs} />
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
          <h3>Upcoming Schedule</h3>
          {timeline.scheduleEvents.length === 0 ? (
            <p className="radio-page__placeholder">No scheduled programs available.</p>
          ) : (
            <ol className="radio-page__upcoming-list">
              {timeline.scheduleEvents
                .filter((event) => Date.parse(event.endUtc) > timeline.nowUtcMs)
                .sort((left, right) => Date.parse(left.startUtc) - Date.parse(right.startUtc))
                .slice(0, 6)
                .map((event) => (
                  <li key={event.eventId}>
                    <span className="radio-page__upcoming-track">
                      {event.title ?? 'Scheduled program'}
                    </span>
                    <span className="radio-page__upcoming-time">
                      {new Intl.DateTimeFormat([], {
                        timeZone: scheduleTimeZone,
                        weekday: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      }).format(Date.parse(event.startUtc))}
                    </span>
                  </li>
                ))}
            </ol>
          )}
        </section>
      </div>
      {station && messageOpen && (
        <MessageOwnerModal station={station} onClose={() => setMessageOpen(false)} />
      )}
      {station && tipOpen && <TipOwnerModal station={station} onClose={() => setTipOpen(false)} />}
      {shareOpen && <ShareModal target={{ kind: 'app' }} onClose={() => setShareOpen(false)} />}
    </PageShell>
  );
}
