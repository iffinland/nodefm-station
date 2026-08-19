/* ============================================================
 * NodeFM Station — Qortium Social Bridge Actions
 *
 * Thin, production-shaped adapters for the current Qortium Home
 * bridge social write paths. These functions never invent
 * transaction or chat payloads; they mirror the handlers in:
 *
 * - qortium-home/electron/qdn.ts
 * - qortium-home/src/platform.ts
 *
 * Specifically:
 * - direct listener-to-owner messages use SEND_CHAT_MESSAGE
 *   with a direct `recipientAddress`;
 * - native station tips use SEND_COIN with `recipient` and
 *   `amount` and go through Home's normal approval flow.
 * ============================================================ */

import { sendBridgeRequest } from './bridge';

export type DirectChatMessageInput = {
  recipientAddress: string;
  message: string;
};

export type DirectChatMessageResult = {
  accepted: true;
  direct: boolean;
  /** Only true when the confirmed bridge response proves encryption. */
  encrypted: boolean;
  recipientAddress: string;
  result: unknown;
};

export type NativeTipInput = {
  recipient: string;
  amount: string;
};

export type NativeTipResult = {
  accepted: true;
  recipient: string;
  amount: string;
  transactionSignature?: string;
  result: unknown;
};

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function acceptedErrorMessage(value: Record<string, unknown>): string {
  if (typeof value.error === 'string' && value.error.trim()) {
    return value.error;
  }

  if (typeof value.reason === 'string' && value.reason.trim()) {
    return value.reason;
  }

  if (typeof value.message === 'string' && value.message.trim()) {
    return value.message;
  }

  return 'Qortium did not accept the social action.';
}

/**
 * Send a direct chat message through the current Home bridge.
 *
 * The recipient is the station owner's wallet address. Sender identity
 * is determined by Home's selected-account context, never from payload.
 */
export async function sendDirectChatMessage(
  input: DirectChatMessageInput,
): Promise<DirectChatMessageResult> {
  const response = await sendBridgeRequest<unknown>({
    action: 'SEND_CHAT_MESSAGE',
    recipientAddress: input.recipientAddress,
    message: input.message,
  });

  const value = requireRecord(response, 'SEND_CHAT_MESSAGE response');

  if (value.accepted !== true) {
    throw new Error(acceptedErrorMessage(value));
  }

  const recipientAddress =
    typeof value.recipientAddress === 'string' ? value.recipientAddress : input.recipientAddress;

  return {
    accepted: true,
    direct: value.direct === true,
    encrypted: value.encrypted === true,
    recipientAddress,
    result: value.result,
  };
}

/**
 * Submit a native-QORT tip through the normal Qortium transaction
 * approval path. The caller must not retry this automatically.
 */
export async function sendNativeTip(input: NativeTipInput): Promise<NativeTipResult> {
  const response = await sendBridgeRequest<unknown>({
    action: 'SEND_COIN',
    recipient: input.recipient,
    amount: input.amount,
  });

  const value = requireRecord(response, 'SEND_COIN response');

  if (value.accepted !== true) {
    throw new Error(acceptedErrorMessage(value));
  }

  const recipient = typeof value.recipient === 'string' ? value.recipient : input.recipient;
  const amount =
    typeof value.amount === 'string' || typeof value.amount === 'number'
      ? String(value.amount)
      : input.amount;
  const transactionSignature =
    typeof value.transactionSignature === 'string' && value.transactionSignature.trim()
      ? value.transactionSignature
      : undefined;

  return {
    accepted: true,
    recipient,
    amount,
    transactionSignature,
    result: value.result,
  };
}
