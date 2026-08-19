/* ============================================================
 * NodeFM Station — Social Account Isolation Contract Tests
 *
 * Social bridge requests must not carry sender identity claims.
 * Home derives the selected account from its own context.
 * ============================================================ */

import { describe, expect, it } from 'vitest';
import { buildDirectMessageRequest } from '../features/messaging/services/messagingService';
import { buildNativeTipRequest } from '../features/tips/services/tipService';

describe('social request account isolation', () => {
  it('keeps sender identity out of the direct-message request', () => {
    const request = buildDirectMessageRequest('Q-owner', 'Hello');

    expect(request).not.toHaveProperty('userAddress');
    expect(request).not.toHaveProperty('sender');
    expect(request).not.toHaveProperty('address');
    expect(request).not.toHaveProperty('ownerName');
  });

  it('keeps sender identity out of the native tip request', () => {
    const request = buildNativeTipRequest('Q-owner', '1.25');

    expect(request).not.toHaveProperty('userAddress');
    expect(request).not.toHaveProperty('sender');
    expect(request).not.toHaveProperty('address');
    expect(request).not.toHaveProperty('ownerName');
  });
});
