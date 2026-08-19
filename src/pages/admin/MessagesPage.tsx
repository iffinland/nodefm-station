/* ============================================================
 * NodeFM Station — Messages Page (Admin)
 *
 * Listener direct messages are delivered through Qortium's
 * native private direct chat. This page points the owner to
 * Home's Chat surface rather than inventing a parallel inbox.
 * ============================================================ */

import { useState } from 'react';
import { PageShell } from '../../components/PageShell';
import { useStation } from '../../features/station';
import { openQdnAddress } from '../../qortium/navigation';

export default function MessagesPage() {
  const { station, loading } = useStation();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpenChat = async () => {
    setOpening(true);
    setError(null);

    try {
      await openQdnAddress('qdn://APP/Chat/Chat', 'new');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open Qortium Chat.');
    } finally {
      setOpening(false);
    }
  };

  return (
    <PageShell title="Messages">
      <div className="admin-messages">
        {loading ? (
          <p className="admin-messages__placeholder">Loading station information…</p>
        ) : (
          <>
            <p className="admin-messages__hint">
              Direct messages to the station are delivered through Qortium Chat using the selected
              owner account. NodeFM does not duplicate Home's private chat store.
            </p>
            {station?.messagingEnabled === false && (
              <p className="form-error">Station messaging is currently disabled.</p>
            )}
            {error && <p className="form-error">{error}</p>}
            <button
              className="button button--primary"
              type="button"
              onClick={handleOpenChat}
              disabled={opening || station?.messagingEnabled === false}
            >
              {opening ? 'Opening…' : 'Open Qortium Chat'}
            </button>
          </>
        )}
      </div>
    </PageShell>
  );
}
