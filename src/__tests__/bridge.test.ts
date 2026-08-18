/* ============================================================
 * NodeFM Station — Bridge Transport Contract Tests
 *
 * Confirms the production bridge resolves `window.qdnRequest`
 * rather than a custom postMessage protocol.
 * ============================================================ */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveBridge, isBridgeAvailable, sendBridgeRequest } from '../qortium/bridge';

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
});
