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
export { resolveAuth, refreshAuth, isStationOwner, listenForAccountChanges } from './auth';
export type { AuthState } from './auth';

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

// ── Account write gate (all signed / QDN writes) ──────────────────
export {
  requireAccountWrite,
  runAccountWrite,
  getAccountWriteReadiness,
  resetAccountWriteGateCache,
  QortiumAccountRequiredError,
  QortiumAccountUnlockUnsupportedError,
  QortiumAccountUnlockCancelledError,
  ACTION_GET_SELECTED_ACCOUNT,
  ACTION_SHOW_ACTIONS,
  ACTION_UNLOCK_SELECTED_ACCOUNT,
  ACCOUNT_SELECTION_ACTIONS,
} from './accountWriteGate';
export type { AccountWriteTicket, AccountWriteReadiness } from './accountWriteGate';

// ── Phase 2 QDN operations ────────────────────────────────────────
export {
  publishResource,
  publishMultipleResources,
  selectPublishSource,
  stageQdnPublishSource,
  getQdnPublishCapability,
  isQdnPublishSourceSupported,
  resetQdnPublishCapabilityCache,
  QdnPublishSourceUnsupportedError,
  QDN_PUBLISH_BATCH_MAX_ITEMS,
  qdnJsonPublishFileName,
  searchQdnResources,
  listQdnResources,
  getQdnResourceMetadata,
  getQdnResourceStreamUrl,
  getQdnResourceUrl,
  ensureQdnResourceReady,
  requireQdnResourceStreamUrl,
  requireQdnResourceUrl,
  decodeQdnResourcePayload,
  fetchQdnResourceData,
  deleteQdnResource,
} from './qdn';
export type {
  PublishInput,
  PublishResult,
  MultiplePublishResult,
  PublishMultipleResource,
  MultiplePublishFailedResource,
  MultiplePublishPublishedResource,
  QdnPublishCapability,
  QdnPublishSourceInput,
  QdnPublishSourceKind,
  StageQdnPublishSourceInput,
  StageQdnPublishSourceResult,
  SelectPublishSourceResult,
  QdnSearchParams,
  QdnResourceInfo,
  QdnResourceMetadata,
  QdnResourceStatus,
} from './qdn';

// ── Navigation / QDN addresses ─────────────────────────────────────
export {
  getCurrentQdnAppIdentity,
  getCanonicalNodeFmAppIdentity,
  buildQdnUrl,
  openQdnAddress,
  NODEFM_APP_SERVICE,
  NODEFM_APP_NAME,
  NODEFM_APP_IDENTIFIER,
} from './navigation';
export type { QdnHostGlobals, OpenTabTarget } from './navigation';

// ── Social bridge write paths ─────────────────────────────────────
export { sendDirectChatMessage, sendNativeTip } from './social';
export type {
  DirectChatMessageInput,
  DirectChatMessageResult,
  NativeTipInput,
  NativeTipResult,
} from './social';
