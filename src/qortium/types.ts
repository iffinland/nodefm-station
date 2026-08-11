/* ============================================================
 * NodeFM Station — Qortium Bridge Types
 *
 * Types for the Qortium Home ↔ Q-App bridge communication.
 * Validated against Qortium Home reference implementation.
 * ============================================================ */

// ── Bridge Request ──────────────────────────────────────────────────

/** QDN request actions supported by the Qortium Home bridge */
export type QdnRequestAction =
  | 'FETCH_QDN_RESOURCE'
  | 'SEARCH_QDN_RESOURCES'
  | 'GET_QDN_RESOURCE_STATUS'
  | 'GET_QDN_RESOURCE_PROPERTIES'
  | 'GET_QDN_RESOURCE_METADATA'
  | 'GET_QDN_RESOURCE_URL'
  | 'GET_SELECTED_ACCOUNT'
  | 'GET_ACCOUNT_NAMES'
  | 'GET_NAME_DATA'
  | 'GET_LIST'
  | 'GET_BALANCE'
  | 'GET_HOME_SETTINGS'
  | 'FETCH_NODE_API'
  | 'PUBLISH_QDN_RESOURCE';

export type QdnBridgeRequest = {
  action: QdnRequestAction;
  [key: string]: unknown;
};

export type QdnBridgeMessage = {
  type: 'qortium:qdn-request';
  requestId: string;
  request: QdnBridgeRequest;
  bridgeToken?: unknown;
};

// ── Bridge Response ─────────────────────────────────────────────────

export type QdnBridgeResponse = {
  type: 'qortium:qdn-response';
  requestId: string;
  response?: unknown;
  error?: string;
};

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

export type QortiumAccount = {
  address: string;
  name?: string;
};

// ── Bridge Resolution ───────────────────────────────────────────────

export type BridgeSource = 'globalThis' | 'window' | 'parent';

export type BridgeResolution =
  { status: 'AVAILABLE'; source: BridgeSource } | { status: 'UNAVAILABLE' };
