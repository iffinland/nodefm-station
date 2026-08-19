/* ============================================================
 * NodeFM Station — Notice Admin Panel
 *
 * Owner-only notice management surface used on the Station
 * Settings page.
 * ============================================================ */

import { useState } from 'react';
import type { StationNotice } from '../../../types/domain';
import { useStation } from '../../station';
import { useNotices } from '../useNotices';
import { NoticeEditorModal } from './NoticeEditorModal';

export function NoticeAdminPanel() {
  const { isOwner } = useStation();
  const { notices, loading, error, incomplete, refresh, saveNotice, deleteNotice } = useNotices();

  const [editingNotice, setEditingNotice] = useState<StationNotice | null | undefined>(undefined);
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (!isOwner) {
    return null;
  }

  const handleDelete = async (notice: StationNotice) => {
    if (!window.confirm(`Delete notice "${notice.title ?? 'Untitled'}"?`)) {
      return;
    }

    setActionError(null);

    try {
      await deleteNotice(notice.noticeId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to delete notice.');
    }
  };

  return (
    <section className="notice-admin">
      <div className="notice-admin__header">
        <h2>Station Notices</h2>
        <button className="button button--primary" type="button" onClick={() => setCreating(true)}>
          New Notice
        </button>
      </div>

      {loading ? (
        <p className="notice-admin__muted">Loading notices…</p>
      ) : error ? (
        <p className="form-error">
          Failed to load notices: {error}{' '}
          <button className="button button--secondary" type="button" onClick={refresh}>
            Retry
          </button>
        </p>
      ) : notices.length === 0 ? (
        <p className="notice-admin__muted">No station notices published yet.</p>
      ) : (
        <ul className="notice-admin__list">
          {notices.map((notice) => (
            <li className="notice-admin__item" key={notice.noticeId}>
              <div className="notice-admin__item-body">
                <strong>{notice.title ?? 'Untitled'}</strong>
                <span>{notice.message}</span>
              </div>
              <div className="notice-admin__item-actions">
                <button
                  className="button button--secondary"
                  type="button"
                  onClick={() => setEditingNotice(notice)}
                >
                  Edit
                </button>
                <button
                  className="button button--secondary"
                  type="button"
                  onClick={() => handleDelete(notice)}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {incomplete && <p className="form-error">Some station notices could not be loaded.</p>}
      {actionError && <p className="form-error">{actionError}</p>}

      {creating && <NoticeEditorModal onClose={() => setCreating(false)} onSave={saveNotice} />}

      {editingNotice && (
        <NoticeEditorModal
          notice={editingNotice}
          onClose={() => setEditingNotice(undefined)}
          onSave={saveNotice}
        />
      )}
    </section>
  );
}
