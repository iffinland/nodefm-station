/* ============================================================
 * NodeFM Station — Radio Page (Public)
 *
 * The primary listener experience.
 * Phase 1: Shell only. Live player and timeline come in Phase 3.
 * ============================================================ */

import { PageShell } from '../components/PageShell';
import { usePlayerState } from '../audio';

export default function RadioPage() {
  const playerState = usePlayerState();

  return (
    <PageShell title="NodeFM Radio">
      <div className="radio-page">
        {/* Now Playing Section */}
        <section className="radio-page__now-playing">
          <div className="now-playing__cover">
            <div className="now-playing__cover-placeholder" aria-hidden="true">
              ♫
            </div>
          </div>
          <div className="now-playing__info">
            <h2 className="now-playing__title">{playerState.currentTrack?.title ?? '—'}</h2>
            <p className="now-playing__artist">
              {playerState.currentTrack?.artist ?? 'No track playing'}
            </p>
            <span className="now-playing__live-badge">LIVE</span>
          </div>
        </section>

        {/* Upcoming Section */}
        <section className="radio-page__upcoming">
          <h3>Coming Up</h3>
          <p className="radio-page__placeholder">
            Track schedule will appear here once the radio timeline is active.
          </p>
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
