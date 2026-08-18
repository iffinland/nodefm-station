/* ============================================================
 * NodeFM Station — Auth Account-Switch Guard Tests
 *
 * Verifies that a stale GET_SELECTED_ACCOUNT resolution cannot
 * overwrite the auth cache after a refresh/account change.
 * ============================================================ */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../qortium/bridge', () => ({
  getSelectedAccount: vi.fn(),
  sendBridgeRequest: vi.fn(),
}));

import { getSelectedAccount } from '../qortium/bridge';
import { refreshAuth, resolveAuth } from '../qortium/auth';

const mockedGetSelectedAccount = vi.mocked(getSelectedAccount);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

describe('auth account-switch guard', () => {
  beforeEach(() => {
    refreshAuth();
    mockedGetSelectedAccount.mockReset();
  });

  it('does not let a stale account resolution overwrite the refreshed auth cache', async () => {
    const accountA = deferred<{ address: string; name?: string }>();

    mockedGetSelectedAccount.mockReturnValueOnce(accountA.promise);

    const aResolution = resolveAuth();

    // Account changes before account A resolves.
    refreshAuth();
    mockedGetSelectedAccount.mockResolvedValueOnce({ address: 'Q-b', name: 'B' });
    const bResolution = resolveAuth();

    accountA.resolve({ address: 'Q-a', name: 'A' });

    await aResolution;
    await bResolution;

    // The cached result must be the latest account, not the stale A value.
    await expect(resolveAuth()).resolves.toEqual({
      status: 'authenticated',
      address: 'Q-b',
      name: 'B',
    });
  });
});
