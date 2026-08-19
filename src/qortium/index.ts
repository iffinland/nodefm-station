// ── Bridge (transport layer) ──────────────────────────────────────
export {
  sendBridgeRequest,
  fetchQdnResource,
  getSelectedAccount,
  getQdnResourceStatus,
  getHomeSettings,
  getRouterBasename,
  resolveBridge,
  isBridgeAvailable,
  QortiumBridgeError,
} from './bridge';
export type { BridgeSource, BridgeResolution, BridgeErrorCode } from './bridge';

// ── Auth ──────────────────────────────────────────────────────────
export {
  resolveAuth,
  refreshAuth,
  isStationOwner,
  listenForAccountChanges,
  publishQdnResource,
} from './auth';
export type { AuthState, PublishResourceInput } from './auth';

// ── Types ─────────────────────────────────────────────────────────
export type {
  QdnRequestAction,
  HomeDisplaySettings,
  HomeSettingsChangedMessage,
  AccountChangedMessage,
  DisplaySettingMessage,
  QdnResourceLocator,
  QortiumAccount,
} from './types';

// ── Phase 2 QDN operations ────────────────────────────────────────
export {
  publishResource,
  selectPublishSource,
  searchQdnResources,
  listQdnResources,
  getQdnResourceMetadata,
  getQdnResourceUrl,
  ensureQdnResourceReady,
  requireQdnResourceUrl,
  decodeQdnResourcePayload,
  fetchQdnResourceData,
  deleteQdnResource,
} from './qdn';
export type {
  PublishInput,
  PublishResult,
  SelectPublishSourceResult,
  QdnSearchParams,
  QdnResourceInfo,
  QdnResourceMetadata,
  QdnResourceStatus,
} from './qdn';

// ── Navigation / QDN addresses ─────────────────────────────────────
export { getCurrentQdnAppIdentity, buildQdnUrl, openQdnAddress } from './navigation';
export type { QdnHostGlobals, OpenTabTarget } from './navigation';

// ── Social bridge write paths ─────────────────────────────────────
export { sendDirectChatMessage, sendNativeTip } from './social';
export type {
  DirectChatMessageInput,
  DirectChatMessageResult,
  NativeTipInput,
  NativeTipResult,
} from './social';
