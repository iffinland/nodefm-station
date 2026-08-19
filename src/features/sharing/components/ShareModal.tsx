/* ============================================================
 * NodeFM Station — Share Modal
 *
 * Copies a canonical QDN address. A copy failure remains visible
 * and is never reported as success.
 * ============================================================ */

import { useEffect, useState } from 'react';
import { Modal } from '../../../components/Modal';
import {
  buildShareTarget,
  copyShareTarget,
  getShareTargetLabel,
  type ShareTargetInput,
} from '../services/shareService';

type Props = {
  target: ShareTargetInput;
  onClose: () => void;
};

export function ShareModal({ target, onClose }: Props) {
  const [shareTarget, setShareTarget] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      setShareTarget(buildShareTarget(target));
      setError(null);
    } catch (err) {
      setShareTarget(null);
      setError(err instanceof Error ? err.message : 'Unable to build share target.');
    }

    setCopied(false);
  }, [target]);

  const handleCopy = async () => {
    if (!shareTarget) {
      return;
    }

    setError(null);
    setCopied(false);

    try {
      const didCopy = await copyShareTarget(shareTarget);

      if (!didCopy) {
        throw new Error('Clipboard copy failed in this Qortium view.');
      }

      setCopied(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to copy share link.');
    }
  };

  return (
    <Modal title={`Share ${getShareTargetLabel(target)}`} onClose={onClose}>
      <p className="share-modal__hint">Copy the canonical QDN address for this target.</p>

      {shareTarget ? (
        <label className="form-field">
          QDN address
          <input
            type="text"
            value={shareTarget}
            readOnly
            onFocus={(event) => event.target.select()}
          />
        </label>
      ) : (
        <p className="share-modal__unavailable">
          {error ?? 'The current QDN app identity is unavailable.'}
        </p>
      )}

      {copied && <p className="form-success">Copied to clipboard.</p>}
      {error && <p className="form-error">{error}</p>}

      <div className="form-actions">
        <button className="button button--secondary" type="button" onClick={onClose}>
          Close
        </button>
        <button
          className="button button--primary"
          type="button"
          onClick={handleCopy}
          disabled={!shareTarget}
        >
          Copy
        </button>
      </div>
    </Modal>
  );
}
