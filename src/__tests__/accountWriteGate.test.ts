import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../qortium/bridge', () => ({
  sendBridgeRequest: vi.fn(),
}));

import { sendBridgeRequest } from '../qortium/bridge';
import {
  ACCOUNT_SELECTION_ACTIONS,
  ACTION_UNLOCK_SELECTED_ACCOUNT,
  QortiumAccountRequiredError,
  QortiumAccountUnlockCancelledError,
  QortiumAccountUnlockUnsupportedError,
  getAccountWriteReadiness,
  resetAccountWriteGateCache,
  runAccountWrite,
} from '../qortium/accountWriteGate';
import {
  deleteQdnResource,
  publishMultipleResources,
  publishResource,
  resetQdnPublishCapabilityCache,
} from '../qortium/qdn';
import { sendDirectChatMessage, sendNativeTip } from '../qortium/social';

const mockedSend = vi.mocked(sendBridgeRequest);

/** The real Home 2.1.0-beta.11 action surface subset NodeFM depends on. */
const HOME_21_ACTIONS = [
  'SHOW_ACTIONS',
  'GET_SELECTED_ACCOUNT',
  'UNLOCK_SELECTED_ACCOUNT',
  'STAGE_QDN_PUBLISH_SOURCE',
  'SELECT_QDN_PUBLISH_SOURCE',
  'PUBLISH_QDN_RESOURCE',
  'PUBLISH_MULTIPLE_QDN_RESOURCES',
  'DELETE_QDN_RESOURCE',
  'SEND_CHAT_MESSAGE',
  'SEND_COIN',
  'SEARCH_QDN_RESOURCES',
  'LIST_QDN_RESOURCES',
  'FETCH_QDN_RESOURCE',
];

const ACCOUNT = {
  address: 'QWifxJWGbJZ6Yo6kiimFkBGcm4AxQefdUm',
  isUnlocked: false,
  name: 'iffi_vaba_mees',
};

type Harness = {
  calls: string[];
  publishes: Record<string, unknown>[];
  unlocks: number;
  lock: () => void;
  setUnlocked: (value: boolean) => void;
  removeAccount: () => void;
};

/**
 * A Home 2.1-shaped bridge double. The account stays locked until the test
 * unlocks it, exactly like the real runtime where Home owns the password
 * dialog and only then reports `isUnlocked: true`.
 */
function installHome(actions: string[] | null = HOME_21_ACTIONS): Harness {
  const calls: string[] = [];
  const publishes: Record<string, unknown>[] = [];
  let unlocked = false;
  let noAccount = false;
  let issued = 0;

  const harness: Harness = {
    calls,
    publishes,
    unlocks: 0,
    lock: () => {
      unlocked = false;
    },
    setUnlocked: (value: boolean) => {
      unlocked = value;
    },
    removeAccount: () => {
      noAccount = true;
    },
  };

  mockedSend.mockImplementation(async (request: Record<string, unknown>) => {
    const action = String(request.action);
    calls.push(action);

    if (action === 'SHOW_ACTIONS') {
      if (actions === null) throw new Error('SHOW_ACTIONS is unavailable.');

      return actions;
    }

    if (action === 'GET_SELECTED_ACCOUNT') {
      if (noAccount) throw new Error('No account is selected for this tab.');

      return { ...ACCOUNT, isUnlocked: unlocked };
    }

    if (action === ACTION_UNLOCK_SELECTED_ACCOUNT) {
      harness.unlocks += 1;

      // Home shows its own password dialog here. A real unlock resolves after
      // Home confirms, so the account object it returns is already unlocked.
      return { ...ACCOUNT, isUnlocked: unlocked };
    }

    if (action === 'STAGE_QDN_PUBLISH_SOURCE') {
      issued += 1;

      return {
        canceled: false,
        fileName: request.fileName,
        kind: 'blob',
        mimeType: typeof request.mimeType === 'string' ? request.mimeType : null,
        size: 3,
        sourceToken: `home-token-${issued}`,
      };
    }

    if (action === 'PUBLISH_QDN_RESOURCE') {
      publishes.push(request);
      const resource = request as { name: string; service: string };

      return {
        accepted: true,
        action,
        resource: { identifier: null, name: resource.name, service: resource.service },
        transactionSignature: 'sig-1',
      };
    }

    if (action === 'PUBLISH_MULTIPLE_QDN_RESOURCES') {
      publishes.push(request);
      const items = Array.isArray(request.resources) ? request.resources : [];

      return {
        accepted: true,
        action,
        failures: [],
        published: items.map((item, index) => ({
          resource: (item as { resource: unknown }).resource,
          transactionSignature: `sig-${index + 1}`,
        })),
      };
    }

    if (action === 'DELETE_QDN_RESOURCE') return { accepted: true };
    if (action === 'SEND_CHAT_MESSAGE') return { accepted: true, direct: false, encrypted: true };
    if (action === 'SEND_COIN') return { accepted: true, amount: '1', recipient: 'Qx' };
    if (action === 'SEARCH_QDN_RESOURCES' || action === 'LIST_QDN_RESOURCES') return [];

    throw new Error(`unexpected action ${action}`);
  });

  return harness;
}

function trackRequest(input: { identifier: string; name: string; service: string }) {
  return {
    ...input,
    bytesBase64: 'YWJj',
    fileName: `${input.identifier}.json`,
    mimeType: 'application/json',
  };
}

function updateLike() {
  return publishResource(
    trackRequest({ identifier: 'nodefm-like-a', name: 'iffi_vaba_mees', service: 'JSON' }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetAccountWriteGateCache();
  resetQdnPublishCapabilityCache();
});

describe('account write gate — read-only use', () => {
  it('does not read or prompt for an account on read-only surfaces', async () => {
    installHome();
    const { getAccountWriteReadiness: readiness } = await import('../qortium/accountWriteGate');
    expect(typeof readiness).toBe('function');

    const { searchQdnResources, listQdnResources, getQdnPublishCapability } =
      await import('../qortium/qdn');
    await getQdnPublishCapability();
    await searchQdnResources({ service: 'JSON' });
    await listQdnResources({ service: 'JSON' });

    const actions = mockedSend.mock.calls.map(([request]) => String(request.action));
    expect(actions).toEqual(['SHOW_ACTIONS', 'SEARCH_QDN_RESOURCES', 'LIST_QDN_RESOURCES']);
    expect(actions).not.toContain('GET_SELECTED_ACCOUNT');
    expect(actions).not.toContain(ACTION_UNLOCK_SELECTED_ACCOUNT);
  });

  it('reports a locked account without prompting', async () => {
    installHome();

    await expect(getAccountWriteReadiness()).resolves.toEqual({
      address: ACCOUNT.address,
      name: ACCOUNT.name,
      status: 'locked',
    });
    expect(mockedSend.mock.calls.map(([request]) => request.action)).toEqual([
      'GET_SELECTED_ACCOUNT',
    ]);
  });
});

describe('account write gate — CASE A (already unlocked)', () => {
  it('executes the write immediately without invoking unlock', async () => {
    const harness = installHome();
    harness.setUnlocked(true);

    await expect(updateLike()).resolves.toMatchObject({ accepted: true });

    expect(harness.unlocks).toBe(0);
    expect(harness.publishes).toHaveLength(1);
    expect(harness.calls).not.toContain(ACTION_UNLOCK_SELECTED_ACCOUNT);
  });
});

describe('account write gate — CASE B (locked, Home unlocks)', () => {
  it('invokes the Home unlock action and then resumes the original write', async () => {
    const harness = installHome();
    harness.lock();

    // Home reports the account unlocked only after its own password dialog.
    const original = mockedSend.getMockImplementation()!;
    mockedSend.mockImplementation(async (request: Record<string, unknown>) => {
      if (request.action === ACTION_UNLOCK_SELECTED_ACCOUNT) {
        harness.unlocks += 1;
        harness.setUnlocked(true);

        return { ...ACCOUNT, isUnlocked: true };
      }

      return original(request);
    });

    await expect(updateLike()).resolves.toMatchObject({ accepted: true });

    expect(harness.unlocks).toBe(1);
    expect(harness.publishes).toHaveLength(1);
    expect(harness.calls.indexOf(ACTION_UNLOCK_SELECTED_ACCOUNT)).toBeLessThan(
      harness.calls.indexOf('PUBLISH_QDN_RESOURCE'),
    );
  });

  it('sends only the Home unlock action and never any credential field', async () => {
    const harness = installHome();
    harness.lock();

    const original = mockedSend.getMockImplementation()!;
    mockedSend.mockImplementation(async (request: Record<string, unknown>) => {
      if (request.action === ACTION_UNLOCK_SELECTED_ACCOUNT) {
        harness.unlocks += 1;
        harness.setUnlocked(true);

        return { ...ACCOUNT, isUnlocked: true };
      }

      return original(request);
    });

    await updateLike();

    const unlockRequest = mockedSend.mock.calls
      .map(([request]) => request)
      .find((request) => request.action === ACTION_UNLOCK_SELECTED_ACCOUNT);

    expect(unlockRequest).toEqual({ action: ACTION_UNLOCK_SELECTED_ACCOUNT });
    expect(JSON.stringify(mockedSend.mock.calls)).not.toMatch(/password|passphrase|seed/i);
  });

  it('shares one unlock prompt across concurrent writes', async () => {
    const harness = installHome();
    harness.lock();

    const original = mockedSend.getMockImplementation()!;
    mockedSend.mockImplementation(async (request: Record<string, unknown>) => {
      if (request.action === ACTION_UNLOCK_SELECTED_ACCOUNT) {
        harness.unlocks += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        harness.setUnlocked(true);

        return { ...ACCOUNT, isUnlocked: true };
      }

      return original(request);
    });

    await Promise.all([updateLike(), updateLike(), updateLike()]);

    expect(harness.unlocks).toBe(1);
    expect(harness.publishes).toHaveLength(3);
  });
});

describe('account write gate — cancel and failure', () => {
  it('aborts with zero writes when Home unlock is cancelled', async () => {
    const harness = installHome();
    harness.lock();

    // Cancelling: Home returns the account still locked and never unlocks.
    await expect(updateLike()).rejects.toBeInstanceOf(QortiumAccountUnlockCancelledError);

    expect(harness.unlocks).toBe(1);
    expect(harness.publishes).toHaveLength(0);
    expect(harness.calls).not.toContain('STAGE_QDN_PUBLISH_SOURCE');
  });

  it('aborts when Home acknowledges the unlock but the account stays locked', async () => {
    const harness = installHome();
    harness.lock();

    const original = mockedSend.getMockImplementation()!;
    mockedSend.mockImplementation(async (request: Record<string, unknown>) => {
      if (request.action === ACTION_UNLOCK_SELECTED_ACCOUNT) {
        harness.unlocks += 1;

        return { acknowledged: true };
      }

      return original(request);
    });

    await expect(updateLike()).rejects.toBeInstanceOf(QortiumAccountUnlockCancelledError);
    expect(harness.publishes).toHaveLength(0);
  });

  it('never retries an unlock automatically', async () => {
    const harness = installHome();
    harness.lock();

    await expect(updateLike()).rejects.toBeInstanceOf(QortiumAccountUnlockCancelledError);

    expect(harness.unlocks).toBe(1);
  });

  it('fails closed when the runtime does not advertise the unlock action', async () => {
    const harness = installHome(
      HOME_21_ACTIONS.filter((a) => a !== ACTION_UNLOCK_SELECTED_ACCOUNT),
    );
    harness.lock();

    await expect(updateLike()).rejects.toBeInstanceOf(QortiumAccountUnlockUnsupportedError);
    expect(harness.publishes).toHaveLength(0);
    expect(harness.unlocks).toBe(0);
  });
});

describe('account write gate — CASE C (no usable selected account)', () => {
  it('reports the Home platform limitation and writes nothing', async () => {
    const harness = installHome();
    harness.removeAccount();

    const error = await updateLike().catch(
      (value: unknown) => value as QortiumAccountRequiredError,
    );

    expect(error).toBeInstanceOf(QortiumAccountRequiredError);
    expect((error as QortiumAccountRequiredError).selectionActions).toEqual([]);
    expect(harness.publishes).toHaveLength(0);
    expect(harness.unlocks).toBe(0);
    expect((error as Error).message).toContain('no app-triggered account selection');
  });

  it('only probes officially advertised account-selection actions', () => {
    expect([...ACCOUNT_SELECTION_ACTIONS]).toEqual([
      'SELECT_ACCOUNT',
      'SELECT_QDN_ACCOUNT',
      'REQUEST_ACCOUNT_SELECTION',
      'REQUEST_ACCOUNT_ONBOARDING',
      'CREATE_ACCOUNT',
      'REQUEST_CREATE_ACCOUNT',
    ]);
  });

  it('surfaces a selection action when a future runtime advertises one', async () => {
    installHome([...HOME_21_ACTIONS, 'SELECT_ACCOUNT']);
    const original = mockedSend.getMockImplementation()!;
    mockedSend.mockImplementation(async (request: Record<string, unknown>) => {
      if (request.action === 'GET_SELECTED_ACCOUNT') {
        throw new Error('No account is selected for this tab.');
      }

      return original(request);
    });

    await expect(getAccountWriteReadiness()).resolves.toMatchObject({
      selectionActions: ['SELECT_ACCOUNT'],
      status: 'no-account',
    });
  });
});

describe('account write gate — coverage of every signed write in the boundary', () => {
  it('gates batch publication', async () => {
    const harness = installHome();
    harness.lock();

    await expect(
      publishMultipleResources([
        trackRequest({ identifier: 'nodefm-a', name: 'iffi_vaba_mees', service: 'JSON' }),
      ]),
    ).rejects.toBeInstanceOf(QortiumAccountUnlockCancelledError);

    expect(harness.publishes).toHaveLength(0);
  });

  it('gates resource deletion', async () => {
    const harness = installHome();
    harness.lock();

    await expect(
      deleteQdnResource({ identifier: 'nodefm-a', name: 'iffi_vaba_mees', service: 'JSON' }),
    ).rejects.toBeInstanceOf(QortiumAccountUnlockCancelledError);

    expect(harness.calls).not.toContain('DELETE_QDN_RESOURCE');
  });

  it('gates direct chat writes and native tips', async () => {
    const harness = installHome();
    harness.lock();

    await expect(
      sendDirectChatMessage({ message: 'hello', recipientAddress: 'Qx' }),
    ).rejects.toBeInstanceOf(QortiumAccountUnlockCancelledError);
    await expect(sendNativeTip({ amount: '1', recipient: 'Qx' })).rejects.toBeInstanceOf(
      QortiumAccountUnlockCancelledError,
    );

    expect(harness.calls).not.toContain('SEND_CHAT_MESSAGE');
    expect(harness.calls).not.toContain('SEND_COIN');
  });

  it('runs the operation exactly once after a successful gate', async () => {
    const harness = installHome();
    harness.setUnlocked(true);
    const operation = vi.fn(async () => 'done');

    await expect(runAccountWrite('TEST_WRITE', operation)).resolves.toBe('done');
    expect(operation).toHaveBeenCalledTimes(1);
    expect(harness.publishes).toHaveLength(0);
  });
});
