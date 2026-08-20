/* ============================================================
 * NodeFM Station — Qortium Bridge
 *
 * Centralized bridge communication with Qortium Home.
 * All QDN/Home requests flow through this module.
 *
 * Adapted from the proven Qortium-native pattern used by
 * discussion-boards-reference (qortiumClient.ts) and
 * qortium-boards (qdnRequest.ts).
 *
 * Bridge: window.qdnRequest(requestObject) → Promise
 *
 * window.qdnRequest is injected by Core's q-apps.js into every
 * QDN-served page.  It uses MessageChannel internally; apps
 * call it directly as a function returning a Promise.
 * ============================================================ */

// ── Types ───────────────────────────────────────────────────────────

type PropertyRead =
  { status: 'AVAILABLE'; value: unknown } | { status: 'UNAVAILABLE' | 'INACCESSIBLE' };

export type BridgeSource = 'globalThis' | 'window' | 'parent' | 'top';

type RequestBridge = {
  request: (payload: Record<string, unknown>) => Promise<unknown> | unknown;
};

export type BridgeResolution =
  | {
      status: 'AVAILABLE';
      source: BridgeSource;
      bridge: RequestBridge;
    }
  | {
      status: 'UNAVAILABLE' | 'MALFORMED' | 'INACCESSIBLE';
      source?: BridgeSource;
    };

export type BridgeErrorCode =
  | 'BRIDGE_UNAVAILABLE'
  | 'BRIDGE_MALFORMED'
  | 'BRIDGE_INACCESSIBLE'
  | 'REQUEST_TIMEOUT'
  | 'REQUEST_FAILED';

// ── Error ───────────────────────────────────────────────────────────

export class QortiumBridgeError extends Error {
  readonly code: BridgeErrorCode;

  constructor(code: BridgeErrorCode, detail: string) {
    super(`[${code}] ${detail}`);
    this.name = 'QortiumBridgeError';
    this.code = code;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readProperty(target: unknown, property: string): PropertyRead {
  if ((typeof target !== 'object' || target === null) && typeof target !== 'function') {
    return { status: 'UNAVAILABLE' };
  }

  try {
    if (!Reflect.has(target, property)) {
      return { status: 'UNAVAILABLE' };
    }

    return { status: 'AVAILABLE', value: Reflect.get(target, property) };
  } catch {
    return { status: 'INACCESSIBLE' };
  }
}

function isBridgeRequestFunction(value: unknown): value is RequestBridge['request'] {
  return typeof value === 'function';
}

function inspectBridgeProperty(target: unknown, source: BridgeSource): BridgeResolution {
  const result = readProperty(target, 'qdnRequest');

  if (result.status !== 'AVAILABLE') {
    return { status: result.status, source };
  }

  if (!isBridgeRequestFunction(result.value)) {
    return {
      status: result.value === null || result.value === undefined ? 'UNAVAILABLE' : 'MALFORMED',
      source,
    };
  }

  return {
    status: 'AVAILABLE',
    source,
    bridge: { request: result.value },
  };
}

// ── Bridge Resolution ───────────────────────────────────────────────

const CANDIDATES: BridgeSource[] = ['globalThis', 'window', 'parent', 'top'];

function getCandidateTarget(source: BridgeSource): unknown {
  switch (source) {
    case 'globalThis':
      return globalThis;
    case 'window':
      return typeof window !== 'undefined' ? window : undefined;
    case 'parent':
    case 'top': {
      if (typeof window === 'undefined') return undefined;
      const prop = readProperty(window, source);
      return prop.status === 'AVAILABLE' ? prop.value : undefined;
    }
  }
}

/**
 * Resolve the Qortium bridge by searching for `qdnRequest` across
 * standard scopes: globalThis, window, window.parent, window.top.
 *
 * Matches the proven pattern from discussion-boards-reference
 * (qortiumClient.ts) and qortium-boards (qdnRequest.ts).
 */
export function resolveBridge(): BridgeResolution {
  let failure: Exclude<BridgeResolution, { status: 'AVAILABLE' }> = {
    status: 'UNAVAILABLE',
  };

  for (const source of CANDIDATES) {
    const target = getCandidateTarget(source);

    if (target === undefined) {
      if (source === 'parent' || source === 'top') {
        // Frame reference is inaccessible (cross-origin) — record it
        if (failure.status === 'UNAVAILABLE') {
          failure = { status: 'INACCESSIBLE', source };
        }
      }
      continue;
    }

    const resolution = inspectBridgeProperty(target, source);

    if (resolution.status === 'AVAILABLE') {
      return resolution;
    }

    if (failure.status === 'UNAVAILABLE' && resolution.status !== 'UNAVAILABLE') {
      failure = resolution;
    }
  }

  return failure;
}

/** Synchronously check whether the Qortium bridge is available. */
export function isBridgeAvailable(): boolean {
  return resolveBridge().status === 'AVAILABLE';
}

// ── Request ─────────────────────────────────────────────────────────

const REQUEST_TIMEOUT_MS = 120_000;
const BRIDGE_WAIT_MS = 4_000;
const BRIDGE_POLL_MS = 200;
const READ_RETRY_COUNT = 2;
const READ_RETRY_DELAY_MS = 500;

/**
 * Read actions that are safe to retry on transient failure.
 * Matches the working set from the reference implementation.
 */
const READ_ACTIONS = new Set([
  'FETCH_QDN_RESOURCE',
  'SEARCH_QDN_RESOURCES',
  'GET_QDN_RESOURCE_STATUS',
  'GET_QDN_RESOURCE_PROPERTIES',
  'GET_QDN_RESOURCE_METADATA',
  'GET_QDN_RESOURCE_URL',
  'GET_SELECTED_ACCOUNT',
  'GET_ACCOUNT_NAMES',
  'GET_NAME_DATA',
  'GET_LIST',
  'GET_BALANCE',
  'GET_HOME_SETTINGS',
  'FETCH_NODE_API',
]);

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

/**
 * Wait up to BRIDGE_WAIT_MS for the bridge to become available.
 * The q-apps.js script may still be initializing during early page load.
 */
async function waitForBridge(): Promise<Extract<BridgeResolution, { status: 'AVAILABLE' }>> {
  const immediate = resolveBridge();

  if (immediate.status === 'AVAILABLE') {
    return immediate;
  }

  let latest: BridgeResolution = immediate;
  const startedAt = Date.now();

  while (Date.now() - startedAt < BRIDGE_WAIT_MS) {
    await sleep(BRIDGE_POLL_MS);
    latest = resolveBridge();

    if (latest.status === 'AVAILABLE') {
      return latest;
    }
  }

  throw toBridgeError(latest);
}

function toBridgeError(
  resolution: Exclude<BridgeResolution, { status: 'AVAILABLE' }>,
): QortiumBridgeError {
  if (resolution.status === 'MALFORMED') {
    return new QortiumBridgeError(
      'BRIDGE_MALFORMED',
      'Qortium bridge is present but not a function.',
    );
  }

  if (resolution.status === 'INACCESSIBLE') {
    return new QortiumBridgeError(
      'BRIDGE_INACCESSIBLE',
      'Qortium bridge scope is inaccessible (cross-origin).',
    );
  }

  return new QortiumBridgeError('BRIDGE_UNAVAILABLE', 'Qortium Home bridge is not available.');
}

function parseRequestError(response: unknown, action: string): string | null {
  if (response === null || response === undefined) {
    return 'Qortium request returned an empty response.';
  }

  if (typeof response === 'string') {
    const trimmed = response.trim();

    if (!trimmed) {
      return 'Qortium request returned an empty response.';
    }

    if (trimmed.toLowerCase() === 'false' || trimmed.toLowerCase().startsWith('error')) {
      return trimmed;
    }

    return null;
  }

  if (!isRecord(response)) {
    return null;
  }

  if (typeof response.error === 'string' && response.error.trim()) {
    return response.error;
  }

  if (response.error === true || response.success === false) {
    return 'Qortium request failed.';
  }

  // A successful FETCH_QDN_RESOURCE payload is domain data. A valid
  // StationNotice (and other future JSON records) can legitimately have a
  // top-level `message` field, so do not interpret that field as a transport
  // error on this read action. Explicit error/success flags above still win.
  if (
    action !== 'FETCH_QDN_RESOURCE' &&
    typeof response.message === 'string' &&
    response.message.trim()
  ) {
    return response.message;
  }

  return null;
}

/**
 * Send a request through the Qortium Home bridge.
 *
 * Uses the injected `window.qdnRequest(requestObject)` function.
 * This is the canonical bridge mechanism used by all working
 * Qortium-native dApps (discussion-boards-reference, qortium-boards).
 *
 * Read actions are retried once on transient failure.
 */
export async function sendBridgeRequest<T = unknown>(request: Record<string, unknown>): Promise<T> {
  const action = typeof request.action === 'string' ? request.action : 'UNKNOWN_ACTION';
  const maxAttempts = READ_ACTIONS.has(action) ? READ_RETRY_COUNT + 1 : 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const resolution = await waitForBridge();

    let didTimeout = false;

    const baseRequestPromise = Promise.resolve().then(() => resolution.bridge.request(request));

    baseRequestPromise.catch(() => {
      if (!didTimeout) {
        return;
      }
    });

    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        didTimeout = true;
        reject(
          new QortiumBridgeError(
            'REQUEST_TIMEOUT',
            `Qortium request ${action} timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds.`,
          ),
        );
      }, REQUEST_TIMEOUT_MS);
    });

    try {
      const response = await Promise.race([baseRequestPromise, timeoutPromise]);
      const requestError = parseRequestError(response, action);

      if (requestError) {
        throw new Error(requestError);
      }

      return response as T;
    } catch (error) {
      if (error instanceof QortiumBridgeError && error.code === 'REQUEST_TIMEOUT') {
        throw error;
      }

      if (attempt >= maxAttempts) {
        throw error instanceof Error
          ? error
          : new QortiumBridgeError('REQUEST_FAILED', `Qortium request ${action} failed.`);
      }

      await sleep(READ_RETRY_DELAY_MS * attempt);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  throw new QortiumBridgeError('REQUEST_FAILED', `Qortium request ${action} failed.`);
}

// ── Convenience: QDN Resource Fetch ─────────────────────────────────

export function fetchQdnResource(
  service: string,
  name: string,
  identifier?: string,
  path?: string,
): Promise<unknown> {
  return sendBridgeRequest({
    action: 'FETCH_QDN_RESOURCE',
    service,
    name,
    identifier,
    ...(path ? { path } : {}),
  });
}

// ── Convenience: Selected Account ───────────────────────────────────

export function getSelectedAccount(): Promise<unknown> {
  return sendBridgeRequest({
    action: 'GET_SELECTED_ACCOUNT',
  });
}

// ── Convenience: QDN Resource Status ────────────────────────────────

export function getQdnResourceStatus(
  service: string,
  name: string,
  identifier?: string,
): Promise<unknown> {
  return sendBridgeRequest({
    action: 'GET_QDN_RESOURCE_STATUS',
    service,
    name,
    identifier,
  });
}

// ── Convenience: Home Settings ──────────────────────────────────────

export function getHomeSettings(): Promise<unknown> {
  return sendBridgeRequest({
    action: 'GET_HOME_SETTINGS',
  });
}

// ── Router basename ─────────────────────────────────────────────────
//
// _qdnBase is a routing/bootstrap value injected by Core's HTMLParser.
// It is NOT a bridge-availability signal.
// Bridge availability is determined by resolveBridge() above.

declare global {
  interface Window {
    _qdnBase?: string;
  }
}

export function getRouterBasename(): string {
  if (typeof window !== 'undefined' && window._qdnBase) {
    return window._qdnBase;
  }

  return '';
}
