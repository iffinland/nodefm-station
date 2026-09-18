/* ============================================================
 * NodeFM Station — Qortium Account Write Gate
 *
 * One shared gate in front of every SIGNED / QDN WRITE action.
 *
 * NodeFM stays fully usable without an unlocked account: opening the
 * app, Live Radio playback, and every public/read-only surface never
 * touches this module. Only a write calls the gate.
 *
 * The gate never handles the wallet password. Locked accounts are
 * unlocked through Home's own action and Home's own password dialog;
 * NodeFM only observes the resulting account state.
 *
 * Contract evidence (Home v2.1.0-beta.11 = 5129317f, tag
 * `v2.1.0-beta.11`):
 * - `GET_SELECTED_ACCOUNT` returns `{ address, name, isUnlocked }` and
 *   throws `No account is selected for this tab.` when no account is
 *   selected for the app tab (electron/qdn.ts, src/platform.ts).
 * - `UNLOCK_SELECTED_ACCOUNT` is only available from a QDN app frame,
 *   throws `No account is selected for this tab.` without a selected
 *   account, shows Home's own unlock dialog, waits for the unlock and
 *   then returns the fresh selected-account object. Cancelling is not an
 *   error: the returned account simply stays locked
 *   (electron/qdn.ts: requestSelectedAccountUnlockForQdnApp,
 *   unlockSelectedAccountForQdnApp).
 * - Home 2.1 advertises no app-triggered account selection, account
 *   creation or onboarding action on either protocol
 *   (electron/qdn-app-actions.ts, electron/home-v2-app-actions.ts).
 *   NodeFM therefore reports that limitation instead of inventing one.
 * ============================================================ */

import { sendBridgeRequest } from './bridge';

export const ACTION_GET_SELECTED_ACCOUNT = 'GET_SELECTED_ACCOUNT';
export const ACTION_SHOW_ACTIONS = 'SHOW_ACTIONS';
export const ACTION_UNLOCK_SELECTED_ACCOUNT = 'UNLOCK_SELECTED_ACCOUNT';

/**
 * Account-selection / onboarding actions a future Home runtime could
 * advertise. Home 2.1 advertises none of them; the gate checks this set at
 * runtime instead of assuming the limitation is permanent.
 */
export const ACCOUNT_SELECTION_ACTIONS = [
  'SELECT_ACCOUNT',
  'SELECT_QDN_ACCOUNT',
  'REQUEST_ACCOUNT_SELECTION',
  'REQUEST_ACCOUNT_ONBOARDING',
  'CREATE_ACCOUNT',
  'REQUEST_CREATE_ACCOUNT',
] as const;

/** Home's wording when the app tab has no selected account. */
const NO_SELECTED_ACCOUNT_PATTERN = /no account is selected/i;

export type AccountWriteTicket = {
  address: string;
  name?: string;
};

export type AccountWriteReadiness =
  | { status: 'ready'; address: string; name?: string }
  | { status: 'locked'; address: string; name?: string }
  | {
      status: 'no-account';
      advertisedActions: readonly string[];
      selectionActions: readonly string[];
    }
  | { status: 'unsupported'; detail: string; advertisedActions: readonly string[] | null };

/**
 * Raised when Home has no usable selected account and no supported
 * app-triggered way to obtain one.
 */
export class QortiumAccountRequiredError extends Error {
  readonly advertisedActions: readonly string[];
  readonly selectionActions: readonly string[];

  constructor(advertisedActions: readonly string[], selectionActions: readonly string[]) {
    super(
      'This Qortium Home runtime has no account selected for this app, so the requested ' +
        'write cannot be signed. Home 2.1 exposes no app-triggered account selection, ' +
        'creation or onboarding action, so select or create an account in Home and retry. ' +
        `Advertised account actions: ${
          advertisedActions.length ? advertisedActions.join(', ') : 'none'
        }.`,
    );
    this.name = 'QortiumAccountRequiredError';
    this.advertisedActions = advertisedActions;
    this.selectionActions = selectionActions;
  }
}

/**
 * Raised when the runtime does not advertise Home's supported unlock action.
 * NodeFM fails closed instead of publishing or signing without an unlocked
 * account.
 */
export class QortiumAccountUnlockUnsupportedError extends Error {
  readonly action: string;

  constructor(action: string, advertisedActions: readonly string[] | null) {
    super(
      `This Qortium Home runtime does not advertise ${ACTION_UNLOCK_SELECTED_ACCOUNT}, so ` +
        `${action} cannot be signed. NodeFM never handles the wallet password and has no ` +
        `fallback for unlocking an account.${
          advertisedActions ? '' : ' SHOW_ACTIONS returned no action list.'
        }`,
    );
    this.name = 'QortiumAccountUnlockUnsupportedError';
    this.action = action;
  }
}

/**
 * Raised when the owner closed or dismissed Home's unlock dialog without
 * unlocking. The original action is aborted and nothing was written.
 */
export class QortiumAccountUnlockCancelledError extends Error {
  readonly action: string;

  constructor(action: string) {
    super(
      `${action} was cancelled: the selected Qortium Home account is still locked, so no ` +
        'write was made. Unlock the account in Home and try again.',
    );
    this.name = 'QortiumAccountUnlockCancelledError';
    this.action = action;
  }
}

let cachedAdvertisedActions: ReadonlySet<string> | null = null;
let inFlightAdvertisedActions: Promise<ReadonlySet<string> | null> | null = null;
let unlockInFlight: Promise<AccountWriteTicket> | null = null;

/** Drop cached capability state (account/route change, tests). */
export function resetAccountWriteGateCache(): void {
  cachedAdvertisedActions = null;
  inFlightAdvertisedActions = null;
  unlockInFlight = null;
}

function normalizeAdvertisedActions(value: unknown): ReadonlySet<string> | null {
  if (!Array.isArray(value)) return null;

  const names = value.filter((entry): entry is string => typeof entry === 'string');

  return names.length === value.length ? new Set(names) : null;
}

async function loadAdvertisedActions(): Promise<ReadonlySet<string> | null> {
  if (cachedAdvertisedActions) return cachedAdvertisedActions;

  inFlightAdvertisedActions ??= sendBridgeRequest<unknown>({ action: ACTION_SHOW_ACTIONS })
    .then(normalizeAdvertisedActions)
    .catch(() => null)
    .finally(() => {
      inFlightAdvertisedActions = null;
    });

  const actions = await inFlightAdvertisedActions;

  if (actions) cachedAdvertisedActions = actions;

  return actions;
}

function isNoSelectedAccountError(error: unknown): boolean {
  return error instanceof Error && NO_SELECTED_ACCOUNT_PATTERN.test(error.message);
}

type NormalizedAccount = { address: string; name?: string; isUnlocked: boolean };

/**
 * Normalize Home's selected-account response. A missing `isUnlocked` is
 * treated as locked: the gate must never assume an account is unlocked.
 */
function normalizeAccount(value: unknown): NormalizedAccount | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  const address = typeof record.address === 'string' ? record.address.trim() : '';

  if (!address) return null;

  return {
    address,
    name: typeof record.name === 'string' && record.name.trim() ? record.name.trim() : undefined,
    isUnlocked: record.isUnlocked === true,
  };
}

async function readSelectedAccountState(): Promise<NormalizedAccount | null> {
  try {
    return normalizeAccount(
      await sendBridgeRequest<unknown>({ action: ACTION_GET_SELECTED_ACCOUNT }),
    );
  } catch (error) {
    if (isNoSelectedAccountError(error)) return null;

    throw error;
  }
}

/**
 * Read the account state a write would be signed with, without prompting.
 *
 * This is safe for read-only surfaces: it only calls `GET_SELECTED_ACCOUNT`.
 */
export async function getAccountWriteReadiness(): Promise<AccountWriteReadiness> {
  const account = await readSelectedAccountState();

  if (!account) {
    const actions = await loadAdvertisedActions();
    const advertised = actions ? [...actions] : [];
    const selectionActions = advertised.filter((action) =>
      (ACCOUNT_SELECTION_ACTIONS as readonly string[]).includes(action),
    );

    return { status: 'no-account', advertisedActions: advertised, selectionActions };
  }

  const ticket = { address: account.address, name: account.name };

  return account.isUnlocked ? { status: 'ready', ...ticket } : { status: 'locked', ...ticket };
}

async function unlockSelectedAccount(action: string): Promise<AccountWriteTicket> {
  const actions = await loadAdvertisedActions();

  if (!actions?.has(ACTION_UNLOCK_SELECTED_ACCOUNT)) {
    throw new QortiumAccountUnlockUnsupportedError(action, actions ? [...actions] : null);
  }

  const raw = await sendBridgeRequest<unknown>({ action: ACTION_UNLOCK_SELECTED_ACCOUNT });
  const fromResponse = normalizeAccount(raw);

  if (fromResponse?.isUnlocked) {
    return { address: fromResponse.address, name: fromResponse.name };
  }

  // Home returns the post-attempt account state. Anything else than an
  // explicit unlock is re-read once before the gate declares a cancellation,
  // so a runtime that answers with a bare acknowledgement cannot be mistaken
  // for a successful unlock.
  const confirmed = await readSelectedAccountState();

  if (confirmed?.isUnlocked) {
    return { address: confirmed.address, name: confirmed.name };
  }

  throw new QortiumAccountUnlockCancelledError(action);
}

/**
 * The single account-write gate.
 *
 * - unlocked account  → resolves immediately, no Home UI;
 * - locked account    → invokes Home's supported unlock action, which shows
 *   Home's own password dialog, and resolves after Home confirms the unlock,
 *   so the caller resumes the original write without a second user click;
 * - no selected account → fails with the exact Home platform limitation;
 * - cancelled unlock  → fails, so the caller aborts with zero writes.
 *
 * Concurrent writes share one unlock prompt.
 */
export async function requireAccountWrite(action = 'QDN_WRITE'): Promise<AccountWriteTicket> {
  const readiness = await getAccountWriteReadiness();

  if (readiness.status === 'ready') {
    return { address: readiness.address, name: readiness.name };
  }

  if (readiness.status === 'no-account') {
    throw new QortiumAccountRequiredError(readiness.advertisedActions, readiness.selectionActions);
  }

  if (readiness.status === 'locked') {
    unlockInFlight ??= unlockSelectedAccount(action).finally(() => {
      unlockInFlight = null;
    });

    return unlockInFlight;
  }

  throw new QortiumAccountUnlockUnsupportedError(action, readiness.advertisedActions);
}

/**
 * Run one signed write behind the shared gate. The operation only starts
 * after the account is confirmed unlocked, and runs exactly once.
 */
export async function runAccountWrite<T>(
  action: string,
  operation: (ticket: AccountWriteTicket) => Promise<T>,
): Promise<T> {
  const ticket = await requireAccountWrite(action);

  return operation(ticket);
}
