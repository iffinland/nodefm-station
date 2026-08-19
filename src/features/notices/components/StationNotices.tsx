/* ============================================================
 * NodeFM Station — Station Notices (Public)
 *
 * Compact active-notice display for the radio and about pages.
 * A failed/incomplete load is never rendered as "no notices".
 * ============================================================ */

import { useNotices } from '../useNotices';
import { getActiveNotices } from '../services/noticeService';

type Props = {
  nowUtcMs: number;
};

export function StationNotices({ nowUtcMs }: Props) {
  const { notices, loading, error, incomplete, refresh } = useNotices();

  if (loading) {
    return (
      <section className="station-notices">
        <h3>Station Notices</h3>
        <p className="station-notices__muted">Loading notices…</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="station-notices">
        <h3>Station Notices</h3>
        <p className="station-notices__error">
          Notice data unavailable: {error}{' '}
          <button className="button button--secondary" type="button" onClick={refresh}>
            Retry
          </button>
        </p>
      </section>
    );
  }

  const activeNotices = getActiveNotices(notices, nowUtcMs);

  return (
    <section className="station-notices">
      <h3>Station Notices</h3>
      {incomplete && (
        <p className="station-notices__error">Some station notices could not be loaded.</p>
      )}
      {activeNotices.length === 0 ? (
        <p className="station-notices__muted">No active station notices.</p>
      ) : (
        <div className="station-notices__list">
          {activeNotices.map((notice) => (
            <article className="station-notice-card" key={notice.noticeId}>
              {notice.title && <h4 className="station-notice-card__title">{notice.title}</h4>}
              <p className="station-notice-card__message">{notice.message}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
