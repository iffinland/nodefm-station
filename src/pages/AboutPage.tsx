/* ============================================================
 * NodeFM Station — About Page (Public)
 *
 * Station information and notices.
 * Phase 1: Shell only.
 * ============================================================ */

import { PageShell } from '../components/PageShell';

export default function AboutPage() {
  return (
    <PageShell title="About NodeFM">
      <div className="about-page">
        <section className="about-page__info">
          <h2>Welcome to NodeFM</h2>
          <p>
            NodeFM is a Qortium-native scheduled auto-DJ radio station. The station runs 24/7 with a
            deterministic timeline derived from published playlists, schedule events, and the
            station clock.
          </p>
        </section>

        <section className="about-page__notices">
          <h3>Station Notices</h3>
          <p className="about-page__placeholder">
            Notices from the station owner will appear here.
          </p>
        </section>
      </div>
    </PageShell>
  );
}
