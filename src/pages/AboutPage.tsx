/* ============================================================
 * NodeFM Station — About Page (Public)
 *
 * Station information and notices.
 * Phase 1: Shell only.
 * ============================================================ */

import { PageShell } from '../components/PageShell';
import { useStation } from '../features/station';
import { StationNotices } from '../features/notices/components';
import { useNowUtcMs } from '../features/radio/hooks/useNowUtcMs';

export default function AboutPage() {
  const { station, loading: stationLoading } = useStation();
  const nowUtcMs = useNowUtcMs();

  return (
    <PageShell title={station?.name ?? 'About NodeFM'}>
      <div className="about-page">
        <section className="about-page__info">
          <h2>{station?.name ?? 'NodeFM'}</h2>
          {stationLoading ? (
            <p className="about-page__placeholder">Loading station information…</p>
          ) : (
            <>
              <p>
                NodeFM is a Qortium-native scheduled auto-DJ radio station. The station runs 24/7
                with a deterministic timeline derived from published playlists, schedule events, and
                the station clock.
              </p>
              {station?.description && <p>{station.description}</p>}
              {station?.ownerName && <p>Station owner: {station.ownerName}</p>}
              <p>
                Station messaging:{' '}
                <strong>{station?.messagingEnabled ? 'Enabled' : 'Disabled'}</strong> ·
                Tips/donations: <strong>{station?.tipsEnabled ? 'Enabled' : 'Disabled'}</strong>
              </p>
            </>
          )}
        </section>

        <div className="about-page__notices">
          <StationNotices nowUtcMs={nowUtcMs} />
        </div>
      </div>
    </PageShell>
  );
}
