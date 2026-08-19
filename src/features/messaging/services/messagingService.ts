/* ============================================================
 * NodeFM Station — Messaging Domain Service
 *
 * Production validation and bridge composition for listener
 * direct messages to the station owner. The raw bridge path is
 * `SEND_CHAT_MESSAGE` with a direct recipient address.
 * ============================================================ */

import { sendDirectChatMessage, type DirectChatMessageResult } from '../../../qortium/social';

export type SendStationMessageInput = {
  recipientAddress: string;
  message: string;
  messagingEnabled: boolean;
};

export function validateStationMessageInput(input: SendStationMessageInput): void {
  if (!input.messagingEnabled) {
    throw new Error('Station messaging is currently disabled by the owner.');
  }

  if (!input.recipientAddress.trim()) {
    throw new Error('Station owner address is required.');
  }

  if (!input.message.trim()) {
    throw new Error('Message text is required.');
  }

  if (new TextEncoder().encode(input.message).length > 4000) {
    throw new Error('Message exceeds the Qortium chat message size limit.');
  }
}

/**
 * Build the exact Qortium bridge request shape for contract tests.
 */
export function buildDirectMessageRequest(
  recipientAddress: string,
  message: string,
): {
  action: 'SEND_CHAT_MESSAGE';
  recipientAddress: string;
  message: string;
} {
  return {
    action: 'SEND_CHAT_MESSAGE',
    recipientAddress,
    message,
  };
}

export async function sendStationMessage(
  input: SendStationMessageInput,
): Promise<DirectChatMessageResult> {
  validateStationMessageInput(input);

  return sendDirectChatMessage({
    recipientAddress: input.recipientAddress,
    message: input.message.trim(),
  });
}
