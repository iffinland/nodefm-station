/* ============================================================
 * NodeFM Station — Notice Editor Modal
 *
 * Owner-only notice create/edit. The modal closes only on a
 * confirmed QDN publish or explicit Close/X.
 * ============================================================ */

import { useEffect, useState } from 'react';
import { Modal } from '../../../components/Modal';
import type { StationNotice } from '../../../types/domain';
import {
  createNotice,
  editNotice,
  toLocalDateTimeInputValue,
  utcFromLocalDateTimeInput,
  type CreateNoticeInput,
} from '../services/noticeService';

type Props = {
  notice?: StationNotice;
  onClose: () => void;
  onSave: (notice: StationNotice) => Promise<unknown>;
};

export function NoticeEditorModal({ notice, onClose, onSave }: Props) {
  const [title, setTitle] = useState(notice?.title ?? '');
  const [message, setMessage] = useState(notice?.message ?? '');
  const [activeFromLocal, setActiveFromLocal] = useState(
    notice?.activeFromUtc ? toLocalDateTimeInputValue(notice.activeFromUtc) : '',
  );
  const [activeUntilLocal, setActiveUntilLocal] = useState(
    notice?.activeUntilUtc ? toLocalDateTimeInputValue(notice.activeUntilUtc) : '',
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTitle(notice?.title ?? '');
    setMessage(notice?.message ?? '');
    setActiveFromLocal(
      notice?.activeFromUtc ? toLocalDateTimeInputValue(notice.activeFromUtc) : '',
    );
    setActiveUntilLocal(
      notice?.activeUntilUtc ? toLocalDateTimeInputValue(notice.activeUntilUtc) : '',
    );
    setError(null);
  }, [notice]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    try {
      const input: CreateNoticeInput = {
        title: title.trim() || undefined,
        message: message.trim(),
        activeFromUtc: utcFromLocalDateTimeInput(activeFromLocal),
        activeUntilUtc: utcFromLocalDateTimeInput(activeUntilLocal),
      };

      const nextNotice = notice ? editNotice(notice, input) : createNotice(input);
      await onSave(nextNotice);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save station notice.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={notice ? 'Edit Notice' : 'Create Notice'} onClose={onClose}>
      <label className="form-field">
        Title (optional)
        <input type="text" value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>

      <label className="form-field">
        Message
        <textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={5} />
      </label>

      <label className="form-field">
        Active from (local time, optional)
        <input
          type="datetime-local"
          value={activeFromLocal}
          onChange={(event) => setActiveFromLocal(event.target.value)}
        />
      </label>

      <label className="form-field">
        Active until (local time, optional)
        <input
          type="datetime-local"
          value={activeUntilLocal}
          onChange={(event) => setActiveUntilLocal(event.target.value)}
        />
      </label>

      {error && <p className="form-error">{error}</p>}

      <div className="form-actions">
        <button className="button button--secondary" type="button" onClick={onClose}>
          Cancel
        </button>
        <button
          className="button button--primary"
          type="button"
          onClick={handleSave}
          disabled={saving || !message.trim()}
        >
          {saving ? 'Publishing…' : notice ? 'Save Notice' : 'Publish Notice'}
        </button>
      </div>
    </Modal>
  );
}
