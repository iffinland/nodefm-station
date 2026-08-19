/* ============================================================
 * NodeFM Station — Tip Owner Modal
 *
 * Financially sensitive. The modal only reports success after
 * the Qortium bridge returns `accepted: true`. It never retries
 * automatically and never converts a failed transaction into a
 * locally successful state.
 * ============================================================ */

import { useEffect, useState } from 'react';
import { Modal } from '../../../components/Modal';
import { useAuth } from '../../../app/providers/authContext';
import type { Station } from '../../../types/domain';
import { sendStationTip } from '../services/tipService';

type Props = {
  station: Station;
  onClose: () => void;
};

function shortAddress(address: string): string {
  if (address.length <= 14) {
    return address;
  }

  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

export function TipOwnerModal({ station, onClose }: Props) {
  const { auth } = useAuth();
  const userAddress = auth.status === 'authenticated' ? auth.address : null;
  const [amount, setAmount] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAmount('');
    setError(null);
    setSending(false);
  }, [userAddress]);

  const recipientLabel = station.ownerName ?? shortAddress(station.ownerAddress);
  const canTip = auth.status === 'authenticated' && station.tipsEnabled;

  const handleTip = async () => {
    if (!userAddress) {
      setError('Select a Qortium account to send a tip.');
      return;
    }

    setSending(true);
    setError(null);

    try {
      await sendStationTip({
        recipient: station.ownerAddress,
        amount,
        tipsEnabled: station.tipsEnabled,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send tip.');
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal title="Tip the Station Owner" onClose={onClose}>
      <p className="social-modal__recipient">
        To: <strong>{recipientLabel}</strong>
      </p>

      {!userAddress && (
        <p className="form-error">Select a Qortium account in Home to send a tip.</p>
      )}

      {userAddress && !station.tipsEnabled && (
        <p className="form-error">Station tips/donations are currently disabled by the owner.</p>
      )}

      <label className="form-field">
        Amount (QORT)
        <input
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder="1.00"
          disabled={!canTip}
        />
      </label>

      {error && <p className="form-error">{error}</p>}

      <div className="form-actions">
        <button className="button button--secondary" type="button" onClick={onClose}>
          Close
        </button>
        <button
          className="button button--primary"
          type="button"
          onClick={handleTip}
          disabled={sending || !amount.trim() || !canTip}
        >
          {sending ? 'Waiting for approval…' : 'Send Tip'}
        </button>
      </div>
    </Modal>
  );
}
