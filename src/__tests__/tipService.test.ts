/* ============================================================
 * NodeFM Station — Tip Service Tests
 * ============================================================ */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../qortium/bridge', () => ({
  sendBridgeRequest: vi.fn(),
}));

import { sendBridgeRequest } from '../qortium/bridge';
import {
  buildNativeTipRequest,
  normalizeTipAmount,
  sendStationTip,
  validateStationTipInput,
} from '../features/tips/services/tipService';

const mockedSend = vi.mocked(sendBridgeRequest);

describe('tip amount validation', () => {
  it('accepts positive amounts with up to eight decimals', () => {
    expect(normalizeTipAmount('1.25')).toBe('1.25');
    expect(normalizeTipAmount('0.00000001')).toBe('0.00000001');
  });

  it('rejects zero, negative, malformed, and too-precise amounts', () => {
    expect(() => normalizeTipAmount('0')).toThrow(/greater than zero/);
    expect(() => normalizeTipAmount('-1')).toThrow(/non-negative amount/);
    expect(() => normalizeTipAmount('1,2')).toThrow(/non-negative amount/);
    expect(() => normalizeTipAmount('1.123456789')).toThrow(/non-negative amount/);
  });

  it('rejects disabled tipping and missing recipients', () => {
    expect(() =>
      validateStationTipInput({ recipient: 'Q-owner', amount: '1', tipsEnabled: false }),
    ).toThrow(/disabled/);
    expect(() =>
      validateStationTipInput({ recipient: ' ', amount: '1', tipsEnabled: true }),
    ).toThrow(/required/);
  });
});

describe('native tip request contract', () => {
  beforeEach(() => {
    mockedSend.mockReset();
  });

  it('builds the exact SEND_COIN request shape', () => {
    expect(buildNativeTipRequest('Q-owner', '1.25')).toEqual({
      action: 'SEND_COIN',
      recipient: 'Q-owner',
      amount: '1.25',
    });
  });

  it('sends a valid tip exactly once and parses success', async () => {
    mockedSend.mockResolvedValue({
      accepted: true,
      recipient: 'Q-owner',
      amount: '1.25',
      transactionSignature: 'tip-tx',
    });

    const result = await sendStationTip({
      recipient: 'Q-owner',
      amount: '1.25',
      tipsEnabled: true,
    });

    expect(mockedSend).toHaveBeenCalledTimes(1);
    expect(mockedSend).toHaveBeenCalledWith({
      action: 'SEND_COIN',
      recipient: 'Q-owner',
      amount: '1.25',
    });
    expect(result.transactionSignature).toBe('tip-tx');
  });

  it('propagates cancel/reject/failure without retry', async () => {
    mockedSend.mockRejectedValue(new Error('USER_CANCELLED'));

    await expect(
      sendStationTip({ recipient: 'Q-owner', amount: '1.25', tipsEnabled: true }),
    ).rejects.toThrow(/USER_CANCELLED/);
    expect(mockedSend).toHaveBeenCalledTimes(1);
  });
});
