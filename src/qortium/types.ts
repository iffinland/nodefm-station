/* ============================================================
 * NodeFM Station — Qortium Bridge Types
 *
 * Types for Qortium Home ↔ Q-App integration.
 * Based on the proven working patterns in:
 *   discussion-boards-reference (qortiumClient.ts)
 *   qortium-boards (qdnRequest.ts)
 *
 * Bridge transport types (BridgeResolution, BridgeSource,
 * BridgeErrorCode) are defined in bridge.ts alongside the
 * implementation to keep the transport layer self-contained.
 * ============================================================ */

// ── QDN Request Actions ─────────────────────────────────────────────

/** QDN request actions supported by the Qortium Home bridge */
export type QdnRequestAction =
  | 'FETCH_QDN_RESOURCE'
  | 'SEARCH_QDN_RESOURCES'
  | 'LIST_QDN_RESOURCES'
  | 'GET_QDN_RESOURCE_STATUS'
  | 'GET_QDN_RESOURCE_PROPERTIES'
  | 'GET_QDN_RESOURCE_METADATA'
  | 'GET_QDN_RESOURCE_URL'
  | 'GET_QDN_RESOURCE_STREAM_URL'
  | 'GET_SELECTED_ACCOUNT'
  | 'GET_ACCOUNT_NAMES'
  | 'GET_NAME_DATA'
  | 'GET_LIST'
  | 'GET_BALANCE'
  | 'GET_HOME_SETTINGS'
  | 'FETCH_NODE_API'
  | 'PUBLISH_QDN_RESOURCE'
  | 'PUBLISH_MULTIPLE_QDN_RESOURCES'
  | 'DELETE_QDN_RESOURCE'
  | 'SELECT_QDN_PUBLISH_SOURCE';

// ── Home Display Settings ───────────────────────────────────────────

export type HomeDisplaySettings = {
  theme: string;
  language: string;
  textSize: string;
  accent: string;
  ui: string;
};

// ── Home Settings Change Message ────────────────────────────────────

export type HomeSettingsChangedMessage = {
  type: 'qortium:home-settings-changed';
  detail: {
    appNotifications?: boolean;
    appZoom?: number;
    lang?: string;
    uiStyle?: string;
    theme?: string;
    language?: string;
    textSize?: string;
    accent?: string;
    ui?: string;
  };
};

// ── Account Changed Message ─────────────────────────────────────────
//
// Home sends this postMessage to the frame when the selected account
// changes. The event is a signal only — apps must re-call
// GET_SELECTED_ACCOUNT after receiving it.

export type AccountChangedMessage = {
  type: 'qortium:selected-account-changed';
};

// ── Display Settings Messages ───────────────────────────────────────

export type DisplaySettingMessage = {
  action: string;
  requestedHandler: string;
  theme?: string;
  language?: string;
  textSize?: string;
  accent?: string;
  uiStyle?: string;
};

// ── QDN Resource Reference ──────────────────────────────────────────

export type QdnResourceLocator = {
  service: string;
  name: string;
  identifier?: string;
  path?: string;
};

// ── Auth / Account ──────────────────────────────────────────────────

/**
 * Shape of GET_SELECTED_ACCOUNT response from Qortium Home.
 * Validated against platform.ts:getSelectedAccountForQdnApp.
 */
export type QortiumAccount = {
  address: string;
  name?: string;
  avatarUrl?: string | null;
  avatarContract?: unknown;
  isUnlocked?: boolean;
};
