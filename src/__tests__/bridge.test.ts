/* ============================================================
 * NodeFM Station — Bridge Transport Contract Tests
 *
 * Confirms the production bridge resolves `window.qdnRequest`
 * rather than a custom postMessage protocol.
 * ============================================================ */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveBridge, isBridgeAvailable, sendBridgeRequest } from '../qortium/bridge';
import { deserializeNoticeFromQdn } from '../features/notices/services/noticeService';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Qortium bridge transport', () => {
  it('resolves window.qdnRequest as the application bridge', () => {
    const qdnRequest = vi.fn();
    vi.stubGlobal('window', { qdnRequest });

    const resolution = resolveBridge();

    expect(resolution.status).toBe('AVAILABLE');
    if (resolution.status === 'AVAILABLE') {
      expect(resolution.source).toBe('window');
      expect(resolution.bridge.request).toBe(qdnRequest);
    }

    expect(isBridgeAvailable()).toBe(true);
  });

  it('reports the bridge unavailable when no qdnRequest is present', () => {
    vi.stubGlobal('window', { parent: {}, top: {} });
    expect(resolveBridge().status).toBe('UNAVAILABLE');
    expect(isBridgeAvailable()).toBe(false);
  });

  it('passes the request object through window.qdnRequest and returns its result', async () => {
    const qdnRequest = vi.fn().mockResolvedValue({ address: 'Q-owner' });
    vi.stubGlobal('window', { qdnRequest });

    await expect(sendBridgeRequest({ action: 'GET_SELECTED_ACCOUNT' })).resolves.toEqual({
      address: 'Q-owner',
    });
    expect(qdnRequest).toHaveBeenCalledWith({ action: 'GET_SELECTED_ACCOUNT' });
  });

  it('passes a successful FETCH_QDN_RESOURCE payload with a top-level message through', async () => {
    const notice = {
      schemaVersion: 1,
      noticeId: 'notice-1',
      message: 'This station is still in BETA testing.',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const qdnRequest = vi.fn().mockResolvedValue(notice);
    vi.stubGlobal('window', { qdnRequest });

    const result = await sendBridgeRequest({
      action: 'FETCH_QDN_RESOURCE',
      service: 'JSON',
      name: 'NodeFM',
      identifier: 'nodefm-notice-notice-1',
    });

    expect(result).toBe(notice);
    expect(deserializeNoticeFromQdn(result)).toEqual(notice);
  });

  it('still rejects an explicit FETCH_QDN_RESOURCE failure with success: false', async () => {
    const qdnRequest = vi.fn().mockResolvedValue({
      success: false,
      message: 'node read failed',
    });
    vi.stubGlobal('window', { qdnRequest });

    await expect(
      sendBridgeRequest({
        action: 'FETCH_QDN_RESOURCE',
        service: 'JSON',
        name: 'NodeFM',
        identifier: 'nodefm-notice-notice-1',
      }),
    ).rejects.toThrow(/Qortium request failed/);
  });

  it('still treats a top-level message as an error for non-resource actions', async () => {
    const qdnRequest = vi.fn().mockResolvedValue({
      message: 'account unavailable',
    });
    vi.stubGlobal('window', { qdnRequest });

    await expect(sendBridgeRequest({ action: 'GET_SELECTED_ACCOUNT' })).rejects.toThrow(
      /account unavailable/,
    );
  });
});
