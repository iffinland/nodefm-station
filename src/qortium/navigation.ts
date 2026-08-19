/* ============================================================
 * NodeFM Station — Qortium Navigation Helpers
 *
 * Canonical QDN address construction and Home navigation for
 * the current app resource and explicit QDN resources.
 *
 * Reference:
 * - qortium-home/src/qdn.ts (buildQdnDisplayUrl)
 * - qortium-home/electron/qdn.ts (OPEN_NEW_TAB/OPEN_CURRENT_TAB)
 * - qortium-boards/src/deepLink.ts (app base address)
 * ============================================================ */

import { sendBridgeRequest } from './bridge';
import type { QdnResourceRef } from '../types/domain';

export type QdnHostGlobals = {
  _qdnService?: unknown;
  _qdnName?: unknown;
  _qdnIdentifier?: unknown;
};

type WindowWithQdnIdentity = Window & QdnHostGlobals;

function cleanGlobal(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function getCurrentQdnAppIdentity(
  host: QdnHostGlobals | null = typeof window === 'undefined'
    ? null
    : (window as WindowWithQdnIdentity),
): QdnResourceRef | null {
  const service = cleanGlobal(host?._qdnService).toUpperCase() || 'APP';
  const name = cleanGlobal(host?._qdnName);
  const identifier = cleanGlobal(host?._qdnIdentifier);

  if (!name || !identifier) {
    return null;
  }

  return {
    service,
    name,
    identifier,
  };
}

export function buildQdnUrl(resource: QdnResourceRef): string {
  if (!resource.service.trim() || !resource.name.trim() || !resource.identifier?.trim()) {
    throw new Error('QDN service, name, and identifier are required to build a QDN address.');
  }

  return `qdn://${resource.service.trim().toUpperCase()}/${encodeURIComponent(resource.name.trim())}/${encodeURIComponent(resource.identifier.trim())}`;
}

export type OpenTabTarget = 'current' | 'new';

/**
 * Ask Home to navigate to a QDN address.
 *
 * Home rejects anything that is not a `qdn://`, `home://`, or
 * `core://` address, matching the current bridge contract.
 */
export async function openQdnAddress(
  address: string,
  target: OpenTabTarget = 'new',
): Promise<void> {
  if (!/^(qdn|home|core):\/\//i.test(address)) {
    throw new Error('Only qdn://, home://, and core:// addresses can be opened by Qortium Home.');
  }

  if (address.length > 2048) {
    throw new Error('QDN address is too long.');
  }

  await sendBridgeRequest({
    action: target === 'current' ? 'OPEN_CURRENT_TAB' : 'OPEN_NEW_TAB',
    address,
  });
}
