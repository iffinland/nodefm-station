/* ============================================================
 * NodeFM Station — Tip Domain Service
 *
 * Native-QORT tip validation and bridge composition. Payments
 * always go through Qortium Home's SEND_COIN approval flow and
 * are never retried automatically.
 * ============================================================ */

import { sendNativeTip, type NativeTipResult } from '../../../qortium/social';

export type SendStationTipInput = {
  recipient: string;
  amount: string;
  tipsEnabled: boolean;
};

const TIP_AMOUNT_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/;

export function normalizeTipAmount(value: string): string {
  const trimmed = value.trim();

  if (!TIP_AMOUNT_PATTERN.test(trimmed)) {
    throw new Error('Tip amount must be a non-negative amount with up to 8 decimal places.');
  }

  const numeric = Number(trimmed);

  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error('Tip amount must be greater than zero.');
  }

  return trimmed;
}

export function buildNativeTipRequest(
  recipient: string,
  amount: string,
): {
  action: 'SEND_COIN';
  recipient: string;
  amount: string;
} {
  return {
    action: 'SEND_COIN',
    recipient,
    amount,
  };
}

export function validateStationTipInput(input: SendStationTipInput): string {
  if (!input.tipsEnabled) {
    throw new Error('Station tips/donations are currently disabled by the owner.');
  }

  if (!input.recipient.trim()) {
    throw new Error('Station owner address is required.');
  }

  return normalizeTipAmount(input.amount);
}

export async function sendStationTip(input: SendStationTipInput): Promise<NativeTipResult> {
  const amount = validateStationTipInput(input);

  return sendNativeTip({
    recipient: input.recipient.trim(),
    amount,
  });
}
