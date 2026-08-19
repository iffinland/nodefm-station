/* ============================================================
 * NodeFM Station — Messaging Service Tests
 * ============================================================ */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../qortium/bridge', () => ({
  sendBridgeRequest: vi.fn(),
}));

import { sendBridgeRequest } from '../qortium/bridge';
import {
  buildDirectMessageRequest,
  sendStationMessage,
  validateStationMessageInput,
} from '../features/messaging/services/messagingService';

const mockedSend = vi.mocked(sendBridgeRequest);

describe('messaging service', () => {
  beforeEach(() => {
    mockedSend.mockReset();
  });

  it('builds the exact SEND_CHAT_MESSAGE request shape', () => {
    expect(buildDirectMessageRequest('Q-owner', 'Hello')).toEqual({
      action: 'SEND_CHAT_MESSAGE',
      recipientAddress: 'Q-owner',
      message: 'Hello',
    });
  });

  it('sends a valid station message exactly once', async () => {
    mockedSend.mockResolvedValue({
      accepted: true,
      direct: true,
      encrypted: true,
      recipientAddress: 'Q-owner',
    });

    await sendStationMessage({
      recipientAddress: 'Q-owner',
      message: 'Hello station',
      messagingEnabled: true,
    });

    expect(mockedSend).toHaveBeenCalledTimes(1);
    expect(mockedSend).toHaveBeenCalledWith({
      action: 'SEND_CHAT_MESSAGE',
      recipientAddress: 'Q-owner',
      message: 'Hello station',
    });
  });

  it('rejects messaging-disabled, empty, and oversized messages', () => {
    expect(() =>
      validateStationMessageInput({
        recipientAddress: 'Q-owner',
        message: 'Hello',
        messagingEnabled: false,
      }),
    ).toThrow(/disabled/);

    expect(() =>
      validateStationMessageInput({
        recipientAddress: 'Q-owner',
        message: ' ',
        messagingEnabled: true,
      }),
    ).toThrow(/required/);

    expect(() =>
      validateStationMessageInput({
        recipientAddress: 'Q-owner',
        message: 'x'.repeat(4001),
        messagingEnabled: true,
      }),
    ).toThrow(/size limit/);
  });

  it('propagates remote send failure as an error', async () => {
    mockedSend.mockRejectedValue(new Error('Direct private chat requires a local Core'));

    await expect(
      sendStationMessage({
        recipientAddress: 'Q-owner',
        message: 'Hello',
        messagingEnabled: true,
      }),
    ).rejects.toThrow(/local Core/);
  });
});
