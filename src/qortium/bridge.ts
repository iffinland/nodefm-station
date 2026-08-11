/* ============================================================
 * NodeFM Station — Qortium Bridge
 *
 * Centralized bridge communication with Qortium Home.
 * All QDN/Home requests flow through this module.
 * UI and domain logic must not build raw bridge payloads directly.
 * ============================================================ */

import type {
  BridgeResolution,
  QdnBridgeMessage,
  QdnBridgeRequest,
  QdnBridgeResponse,
} from './types';

// ── Bridge Detection ────────────────────────────────────────────────

declare global {
  interface Window {
    _qdnBase?: string;
  }
}

const BRIDGE_MESSAGE_TYPE = 'qortium:qdn-request';
const BRIDGE_RESPONSE_TYPE = 'qortium:qdn-response';
const REQUEST_TIMEOUT_MS = 120_000;

function generateRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function resolveBridge(): BridgeResolution {
  const scope =
    typeof globalThis !== 'undefined' ? (globalThis as Record<string, unknown>) : undefined;

  if (scope && typeof (scope as Record<string, unknown>)._qdnBase === 'string') {
    return { status: 'AVAILABLE', source: 'globalThis' };
  }

  if (typeof window !== 'undefined' && typeof window._qdnBase === 'string') {
    return { status: 'AVAILABLE', source: 'window' };
  }

  return { status: 'UNAVAILABLE' };
}

// ── Request ─────────────────────────────────────────────────────────

export class QortiumBridgeError extends Error {
  readonly code: string;

  constructor(code: string, detail: string) {
    super(`[${code}] ${detail}`);
    this.name = 'QortiumBridgeError';
    this.code = code;
  }
}

/**
 * Send a request through the Qortium Home bridge.
 *
 * Uses window.parent.postMessage() with the standard
 * `qortium:qdn-request` message type.
 */
export function sendBridgeRequest(request: QdnBridgeRequest): Promise<unknown> {
  const bridge = resolveBridge();

  if (bridge.status === 'UNAVAILABLE') {
    return Promise.reject(
      new QortiumBridgeError('BRIDGE_UNAVAILABLE', 'Qortium Home bridge is not available.'),
    );
  }

  const requestId = generateRequestId();
  const message: QdnBridgeMessage = {
    type: BRIDGE_MESSAGE_TYPE,
    requestId,
    request,
  };

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new QortiumBridgeError('REQUEST_TIMEOUT', `Request ${request.action} timed out.`));
    }, REQUEST_TIMEOUT_MS);

    const handleResponse = (event: MessageEvent) => {
      const data = event.data as QdnBridgeResponse;

      if (data?.type !== BRIDGE_RESPONSE_TYPE || data?.requestId !== requestId) {
        return;
      }

      cleanup();

      if (data.error) {
        reject(new QortiumBridgeError('REQUEST_FAILED', data.error));
        return;
      }

      resolve(data.response);
    };

    const cleanup = () => {
      clearTimeout(timeoutId);
      window.removeEventListener('message', handleResponse);
    };

    window.addEventListener('message', handleResponse);

    try {
      window.parent.postMessage(message, '*');
    } catch (error) {
      cleanup();
      reject(
        new QortiumBridgeError(
          'BRIDGE_INACCESSIBLE',
          error instanceof Error ? error.message : 'Unable to post bridge message.',
        ),
      );
    }
  });
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

export function getRouterBasename(): string {
  if (typeof window !== 'undefined' && window._qdnBase) {
    return window._qdnBase;
  }

  return '';
}
