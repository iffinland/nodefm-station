/* ============================================================
 * NodeFM Station — Social Bridge Contract Tests
 *
 * Verifies direct chat, native tip, and navigation bridge shapes
 * against the current Qortium Home implementation.
 * ============================================================ */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../qortium/bridge', () => ({
  sendBridgeRequest: vi.fn(),
}));

import { sendBridgeRequest } from '../qortium/bridge';
import { sendDirectChatMessage, sendNativeTip } from '../qortium/social';
import { buildQdnUrl, getCurrentQdnAppIdentity, openQdnAddress } from '../qortium/navigation';

const mockedSend = vi.mocked(sendBridgeRequest);

describe('SEND_CHAT_MESSAGE direct bridge path', () => {
  beforeEach(() => {
    mockedSend.mockReset();
  });

  it('sends the exact direct-recipient request and returns confirmed result', async () => {
    mockedSend.mockResolvedValue({
      accepted: true,
      action: 'SEND_CHAT_MESSAGE',
      direct: true,
      encrypted: true,
      recipientAddress: 'Q-owner',
      result: { signature: 'tx-1' },
    });

    const result = await sendDirectChatMessage({
      recipientAddress: 'Q-owner',
      message: 'Hello station',
    });

    expect(mockedSend).toHaveBeenCalledWith({
      action: 'SEND_CHAT_MESSAGE',
      recipientAddress: 'Q-owner',
      message: 'Hello station',
    });
    expect(result.accepted).toBe(true);
    expect(result.direct).toBe(true);
    expect(result.encrypted).toBe(true);
  });

  it('never reports an unaccepted response as sent', async () => {
    mockedSend.mockResolvedValue({
      accepted: false,
      reason: 'USER_CANCELLED',
    });

    await expect(
      sendDirectChatMessage({ recipientAddress: 'Q-owner', message: 'Hello' }),
    ).rejects.toThrow(/USER_CANCELLED/);
  });

  it('does not claim encryption unless the bridge proves it', async () => {
    mockedSend.mockResolvedValue({
      accepted: true,
      action: 'SEND_CHAT_MESSAGE',
      direct: true,
      encrypted: false,
      recipientAddress: 'Q-owner',
    });

    const result = await sendDirectChatMessage({
      recipientAddress: 'Q-owner',
      message: 'Hello',
    });

    expect(result.encrypted).toBe(false);
  });
});

describe('SEND_COIN native tip bridge path', () => {
  beforeEach(() => {
    mockedSend.mockReset();
  });

  it('sends the exact native tip request and parses a confirmed signature', async () => {
    mockedSend.mockResolvedValue({
      accepted: true,
      action: 'SEND_COIN',
      recipient: 'Q-owner',
      amount: '1.25',
      result: { signature: 'tip-tx' },
      transactionSignature: 'tip-tx',
    });

    const result = await sendNativeTip({ recipient: 'Q-owner', amount: '1.25' });

    expect(mockedSend).toHaveBeenCalledWith({
      action: 'SEND_COIN',
      recipient: 'Q-owner',
      amount: '1.25',
    });
    expect(result.accepted).toBe(true);
    expect(result.transactionSignature).toBe('tip-tx');
  });

  it('throws for rejected/cancelled tip responses', async () => {
    mockedSend.mockResolvedValue({ accepted: false, reason: 'USER_CANCELLED' });

    await expect(sendNativeTip({ recipient: 'Q-owner', amount: '1.25' })).rejects.toThrow(
      /USER_CANCELLED/,
    );
  });
});

describe('QDN navigation helpers', () => {
  beforeEach(() => {
    mockedSend.mockReset();
  });

  it('builds canonical qdn:// addresses', () => {
    expect(
      buildQdnUrl({
        service: 'PLAYLIST',
        name: 'Learning DEV - iffi',
        identifier: 'nodefm-playlist-p1',
      }),
    ).toBe('qdn://PLAYLIST/Learning%20DEV%20-%20iffi/nodefm-playlist-p1');
  });

  it('reads app identity from QDN host globals', () => {
    expect(
      getCurrentQdnAppIdentity({
        _qdnService: 'APP',
        _qdnName: 'NodeFM',
        _qdnIdentifier: 'NodeFM',
      }),
    ).toEqual({ service: 'APP', name: 'NodeFM', identifier: 'NodeFM' });
  });

  it('opens a new tab through the exact bridge action', async () => {
    mockedSend.mockResolvedValue(true);

    await openQdnAddress('qdn://APP/NodeFM/NodeFM', 'new');

    expect(mockedSend).toHaveBeenCalledWith({
      action: 'OPEN_NEW_TAB',
      address: 'qdn://APP/NodeFM/NodeFM',
    });
  });

  it('rejects unsupported navigation schemes before calling the bridge', async () => {
    await expect(openQdnAddress('https://example.com', 'new')).rejects.toThrow(
      /Only qdn:\/\/, home:\/\/, and core:\/\//,
    );
    expect(mockedSend).not.toHaveBeenCalled();
  });
});
