/* ============================================================
 * NodeFM Station — Bulk Import Home 2 Publication Adapter
 *
 * This is the real Home 2.0.0 native-source publication adapter
 * for Workflow A2-1/A2-2.
 *
 * It is deliberately adapter-local. The frozen A1 publication
 * boundary types, journal helpers, and storage serializers are
 * not changed. Raw Home source tokens live only inside the
 * in-memory handle registry below; they are never returned,
 * persisted, or placed on a durable domain object.
 * ============================================================ */

import { sendBridgeRequest } from '../../qortium/bridge';
import {
  getSubmissionAudioQdnIdentifier,
  getSubmissionCoverQdnIdentifier,
  getSubmissionQdnIdentifier,
} from '../listener-submissions/services/submissionService';
import {
  getAudioQdnIdentifier,
  getCoverQdnIdentifier,
  getTrackQdnIdentifier,
} from '../tracks/services/trackService';
import { generateId } from '../../utils/id';
import { isRecord } from '../../utils/record';
import { computeAudioContentRevision, computeCoverContentRevision } from './contentRevision';
import {
  getRequiredPublicationContentRevision,
  isPublishedPublicationStep,
  isUnknownPublicationStep,
} from './publicationJournal';
import {
  mapBulkImportRoleToPublicationIntent,
  unavailableBulkPublicationAdapter,
} from './publicationAdapter';
import type {
  BulkPublicationAcquisitionResult,
  BulkPublicationAdapter,
  BulkPublicationBatchResult,
  BulkPublicationCapability,
  BulkPublicationIntent,
  BulkPublicationResourceStepKind,
  BulkPublicationRowIntent,
  BulkPublicationRowResult,
  BulkPublicationSourceDescriptor,
  BulkPublicationStepResult,
} from './publicationAdapter';
import type {
  BulkImportPublicationError,
  BulkImportPublicationReference,
  BulkImportPublicationResourceIdentity,
  BulkImportLocalSourceDescriptor,
} from './types';

const ACTION_SELECT = 'SELECT_QDN_PUBLISH_SOURCE';
const ACTION_PUBLISH = 'PUBLISH_QDN_RESOURCE';
const ACTION_SHOW_ACTIONS = 'SHOW_ACTIONS';
const ACTION_GET_HOST_INFO = 'GET_HOST_INFO';

const QDN_BRIDGE_RESULT_KEY = '__qdnBridgeResult_9f5f01d1';
const QDN_BRIDGE_ERROR_KEY = '__qdnBridgeError_9f5f01d1';

export type Home2BulkPublicationPlatform = 'desktop' | 'android';

export type Home2BridgeTransport = (request: Record<string, unknown>) => Promise<unknown>;

export type Home2RowAcquisitionResult = BulkPublicationAcquisitionResult & {
  canceled: boolean;
};

export class Home2ReconciliationRequiredError extends Error {
  readonly attemptId: string;

  constructor(attemptId: string, message: string) {
    super(message);
    this.name = 'Home2ReconciliationRequiredError';
    this.attemptId = attemptId;
  }
}

export class Home2AndroidSequentialAcquisitionRequiredError extends Error {
  constructor() {
    super(
      'Android Home 2 holds exactly one pending source. Acquire and publish one row at a time.',
    );
    this.name = 'Home2AndroidSequentialAcquisitionRequiredError';
  }
}

type Home2SourceHandle = {
  batchId: string;
  rowId: string;
  sourceGeneration: number;
  resourceKind: BulkPublicationResourceStepKind;
  handleId: string;
  sourceToken: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  acquiredAt: string;
  consumed: boolean;
};

type Home2SourceExpectation = {
  fileName: string;
  mimeType: string;
  sizeBytes: number | null;
};

type Home2RawSelectResult =
  | { canceled: true }
  | {
      canceled: false;
      fileName: string;
      kind: 'file' | 'directory';
      mimeType: string | null;
      size: number;
      sourceToken: string;
    };

type Home2RawPublishResult = {
  accepted: boolean;
  error?: string;
  errorType?: string;
  outcome?: 'unknown';
  retryable?: boolean;
  resource?: {
    service?: string;
    name?: string;
    identifier?: string | null;
  };
  source?: {
    fileName?: string;
    size?: number;
  };
  transactionSignature?: string;
  immutable?: {
    algorithm?: string;
    contentHash?: string;
    transactionSignature?: string;
  };
};

type Home2AdapterState = {
  capability: BulkPublicationCapability;
  hostPlatform: Home2BulkPublicationPlatform | null;
  handles: Map<string, Home2SourceHandle>;
};

export type Home2BulkPublicationAdapter = BulkPublicationAdapter & {
  detectCapability: () => Promise<BulkPublicationCapability>;
  getHostPlatform: () => Home2BulkPublicationPlatform | null;
  acquireRowSource: (
    intent: BulkPublicationIntent,
    rowId: string,
  ) => Promise<Home2RowAcquisitionResult>;
  acquireCoverSource: (
    intent: BulkPublicationIntent,
    rowId: string,
  ) => Promise<Home2RowAcquisitionResult>;
  acquireMetadataSource: (
    intent: BulkPublicationIntent,
    rowId: string,
    expected: BulkImportLocalSourceDescriptor,
  ) => Promise<Home2RowAcquisitionResult>;
  publishRow: (
    intent: BulkPublicationIntent,
    source: BulkPublicationSourceDescriptor,
  ) => Promise<BulkPublicationRowResult>;
  publishCover: (
    intent: BulkPublicationIntent,
    source: BulkPublicationSourceDescriptor,
  ) => Promise<BulkPublicationRowResult>;
  publishMetadata: (
    intent: BulkPublicationIntent,
    source: BulkPublicationSourceDescriptor,
    expectedMetadata?: BulkImportLocalSourceDescriptor,
  ) => Promise<BulkPublicationRowResult>;
  dispose: () => void;
};

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asNonEmptyString(value: unknown): string | null {
  const text = asString(value).trim();
  return text ? text : null;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return fallback;
}

function errorCode(error: unknown): string | null {
  if (!isRecord(error)) return null;
  return asNonEmptyString(error.code);
}

function errorRetryable(error: unknown): boolean | null {
  if (!isRecord(error)) return null;
  return typeof error.retryable === 'boolean' ? error.retryable : null;
}

function classifyError(error: unknown, action: string): BulkImportPublicationError {
  const message = errorMessage(error, `Home 2 ${action} failed.`);
  const explicitCode = errorCode(error);
  const explicitRetryable = errorRetryable(error);

  if (explicitCode) {
    return {
      code: explicitCode.toUpperCase(),
      message,
      retryable: explicitRetryable ?? false,
    };
  }

  const lower = message.toLowerCase();
  let code = 'PUBLICATION_FAILED';
  let retryable = false;

  if (lower.includes('expired') || lower.includes('no longer safely readable')) {
    code = 'SOURCE_EXPIRED';
  } else if (lower.includes('denied') || lower.includes('account access was denied')) {
    code = 'PUBLICATION_DENIED';
  } else if (
    lower.includes('does not currently own') ||
    lower.includes('publisher-name ownership') ||
    lower.includes('primary name')
  ) {
    code = 'PUBLISHER_NAME_UNAUTHORIZED';
  } else if (lower.includes('unavailable on the configured') || lower.includes('capability')) {
    code = 'NODE_CAPABILITY_MISSING';
  } else if (lower.includes('route') || lower.includes('node')) {
    code = 'NODE_ROUTE_UNAVAILABLE';
  } else if (lower.includes('reconciliation')) {
    code = 'PENDING_TRANSACTION_RECONCILIATION_REQUIRED';
  } else if (
    lower.includes('malformed') ||
    lower.includes('valid home-issued') ||
    lower.includes('source token')
  ) {
    code = 'MALFORMED_PUBLISH_REQUEST';
  }

  if (explicitRetryable !== null) {
    retryable = explicitRetryable;
  }

  return { code, message, retryable };
}

function unwrapHome2BridgeResponse(value: unknown): unknown {
  if (!isRecord(value)) return value;

  const keys = Object.keys(value);
  if (keys.length === 1 && QDN_BRIDGE_ERROR_KEY in value) {
    const payload = isRecord(value[QDN_BRIDGE_ERROR_KEY]) ? value[QDN_BRIDGE_ERROR_KEY] : {};
    const message = asNonEmptyString(payload.message) ?? 'Qortium Home bridge request failed.';
    const error = new Error(message);

    for (const key of [
      'action',
      'code',
      'network',
      'outcome',
      'retryable',
      'routeRevision',
      'target',
    ] as const) {
      if (payload[key] !== undefined) {
        Object.assign(error, { [key]: payload[key] });
      }
    }

    throw error;
  }

  if (keys.length === 1 && QDN_BRIDGE_RESULT_KEY in value) {
    return value[QDN_BRIDGE_RESULT_KEY];
  }

  return value;
}

async function requestUnwrapped(
  transport: Home2BridgeTransport,
  request: Record<string, unknown>,
): Promise<unknown> {
  return unwrapHome2BridgeResponse(await transport(request));
}

function parseShowActions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && !!entry.trim());
}

function parseHostPlatform(value: unknown): Home2BulkPublicationPlatform | null {
  if (!isRecord(value)) return null;
  const platform = asString(value.platform).toLowerCase();
  if (platform === 'desktop' || platform === 'android') return platform;
  return null;
}

async function detectHome2Capability(transport: Home2BridgeTransport): Promise<{
  capability: BulkPublicationCapability;
  hostPlatform: Home2BulkPublicationPlatform | null;
}> {
  let actions: unknown;

  try {
    actions = await requestUnwrapped(transport, { action: ACTION_SHOW_ACTIONS });
  } catch (error) {
    return {
      capability: {
        status: 'unavailable',
        reason: 'requires-home-2-capability',
        message: `Home 2 publication capability is unavailable: ${errorMessage(
          error,
          'SHOW_ACTIONS failed.',
        )}`,
      },
      hostPlatform: null,
    };
  }

  const availableActions = new Set(parseShowActions(actions));
  const missing = [ACTION_SELECT, ACTION_PUBLISH].filter((action) => !availableActions.has(action));

  if (missing.length > 0) {
    return {
      capability: {
        status: 'unavailable',
        reason: 'requires-home-2-capability',
        message: `Bulk publication requires Home 2 native actions: ${missing.join(', ')}.`,
      },
      hostPlatform: null,
    };
  }

  let hostInfo: unknown = null;
  try {
    hostInfo = await requestUnwrapped(transport, { action: ACTION_GET_HOST_INFO });
  } catch {
    hostInfo = null;
  }

  const hostPlatform = parseHostPlatform(hostInfo);
  const platformLabel =
    hostPlatform === 'android' ? 'Android' : hostPlatform === 'desktop' ? 'desktop' : 'Home';

  return {
    capability: {
      status: 'available',
      message: `Home 2 native ${platformLabel} publication is available.`,
    },
    hostPlatform,
  };
}

function resourceKey(
  batchId: string,
  rowId: string,
  sourceGeneration: number,
  resourceKind: BulkPublicationResourceStepKind,
): string {
  return `${batchId}\u001f${rowId}\u001f${sourceGeneration}\u001f${resourceKind}`;
}

function audioExpectation(
  source: BulkImportLocalSourceDescriptor | null,
): Home2SourceExpectation | null {
  if (!source) return null;
  return {
    fileName: source.fileName,
    mimeType: source.mimeType,
    sizeBytes: source.sizeBytes,
  };
}

function coverExpectation(row: BulkPublicationRowIntent): Home2SourceExpectation | null {
  if (!row.cover || row.cover.sizeBytes === null) return null;
  return {
    fileName: row.cover.fileName ?? '',
    mimeType: row.cover.mimeType ?? '',
    sizeBytes: row.cover.sizeBytes,
  };
}

function expectedDescriptorsMatch(
  expectation: Home2SourceExpectation,
  candidate: BulkImportLocalSourceDescriptor,
): boolean {
  if (expectation.sizeBytes !== null && expectation.sizeBytes !== candidate.sizeBytes) {
    return false;
  }

  if (expectation.fileName && candidate.fileName && expectation.fileName !== candidate.fileName) {
    return false;
  }

  if (expectation.mimeType && candidate.mimeType && expectation.mimeType !== candidate.mimeType) {
    return false;
  }

  return true;
}

function sourceDescriptorToExpectation(
  descriptor: BulkImportLocalSourceDescriptor,
): Home2SourceExpectation {
  return {
    fileName: descriptor.fileName,
    mimeType: descriptor.mimeType,
    sizeBytes: descriptor.sizeBytes,
  };
}

function findRow(intent: BulkPublicationIntent, rowId: string): BulkPublicationRowIntent | null {
  return intent.rows.find((row) => row.rowId === rowId) ?? null;
}

function validateRoleIntent(intent: BulkPublicationIntent): void {
  const expected = mapBulkImportRoleToPublicationIntent(intent.role);

  for (const row of intent.rows) {
    if (row.roleIntent !== expected) {
      throw new Error(
        `Inconsistent role intent for row ${row.rowId}: expected ${expected}, received ${row.roleIntent}.`,
      );
    }
  }
}

function normalizeSourceDescriptor(raw: unknown): Home2RawSelectResult | null {
  if (!isRecord(raw)) return null;
  if (raw.canceled === true) return { canceled: true };

  const fileName = asNonEmptyString(raw.fileName);
  const kind = asString(raw.kind);
  const size = typeof raw.size === 'number' && Number.isSafeInteger(raw.size) ? raw.size : -1;
  const sourceToken = asNonEmptyString(raw.sourceToken);
  const mimeType = asOptionalString(raw.mimeType) ?? '';

  if (raw.canceled !== false || !fileName || kind !== 'file' || size < 1 || !sourceToken) {
    return null;
  }

  return {
    canceled: false,
    fileName,
    kind: 'file',
    mimeType: raw.mimeType === null ? null : mimeType,
    size,
    sourceToken,
  };
}

function normalizeReference(
  resource: NonNullable<Home2RawPublishResult['resource']>,
): BulkImportPublicationReference | null {
  const service = asNonEmptyString(resource.service);
  const name = asNonEmptyString(resource.name);
  if (!service || !name) return null;

  const identifier = asNonEmptyString(resource.identifier);
  return identifier ? { service, name, identifier } : { service, name };
}

function referenceMatchesIntent(
  reference: BulkImportPublicationReference,
  intent: BulkImportPublicationResourceIdentity,
): boolean {
  if (
    reference.service !== intent.service ||
    reference.name !== intent.name ||
    intent.identifier === null
  ) {
    return false;
  }

  if (intent.identifier === null) {
    return reference.identifier === undefined;
  }

  return reference.identifier === intent.identifier;
}

function makeFailedResult(
  intent: BulkPublicationIntent,
  row: BulkPublicationRowIntent,
  resourceIntent: BulkImportPublicationResourceIdentity,
  contentRevision: string,
  error: BulkImportPublicationError,
): BulkPublicationStepResult {
  return {
    status: 'failed',
    batchId: intent.batchId,
    rowId: row.rowId,
    sourceGeneration: row.sourceGeneration,
    step: resourceIntent.kind,
    intent: resourceIntent,
    contentRevision,
    attemptId: generateId(),
    error,
  };
}

function makeUnknownResult(
  intent: BulkPublicationIntent,
  row: BulkPublicationRowIntent,
  resourceIntent: BulkImportPublicationResourceIdentity,
  contentRevision: string,
  attemptId: string,
): BulkPublicationStepResult {
  return {
    status: 'unknown',
    batchId: intent.batchId,
    rowId: row.rowId,
    sourceGeneration: row.sourceGeneration,
    step: resourceIntent.kind,
    intent: resourceIntent,
    contentRevision,
    attemptId,
  };
}

function acquisitionFailure(
  batchId: string,
  rowId: string,
  sourceGeneration: number,
  error: BulkImportPublicationError,
): BulkPublicationAcquisitionResult['failedRows'][number] {
  return { batchId, rowId, sourceGeneration, error };
}

export function createHome2BulkPublicationAdapter(
  options: {
    transport?: Home2BridgeTransport;
    now?: () => string;
  } = {},
): Home2BulkPublicationAdapter {
  const transport = options.transport ?? (sendBridgeRequest as Home2BridgeTransport);
  const now = options.now ?? (() => new Date().toISOString());

  const state: Home2AdapterState = {
    capability: unavailableBulkPublicationAdapter.capability(),
    hostPlatform: null,
    handles: new Map(),
  };

  async function detectCapability(): Promise<BulkPublicationCapability> {
    const detected = await detectHome2Capability(transport);
    state.capability = detected.capability;
    state.hostPlatform = detected.hostPlatform;
    return detected.capability;
  }

  function getHostPlatform(): Home2BulkPublicationPlatform | null {
    return state.hostPlatform;
  }

  function handleMatchesExpectation(
    handle: Home2SourceHandle,
    expectation: Home2SourceExpectation,
  ): boolean {
    if (expectation.sizeBytes !== null && handle.sizeBytes !== expectation.sizeBytes) {
      return false;
    }

    if (expectation.fileName && handle.fileName && handle.fileName !== expectation.fileName) {
      return false;
    }

    if (expectation.mimeType && handle.mimeType && handle.mimeType !== expectation.mimeType) {
      return false;
    }

    return true;
  }

  function handleDescriptor(handle: Home2SourceHandle): BulkPublicationSourceDescriptor {
    return {
      rowId: handle.rowId,
      sourceGeneration: handle.sourceGeneration,
      handleId: handle.handleId,
      fileName: handle.fileName,
      mimeType: handle.mimeType,
      sizeBytes: handle.sizeBytes,
      available: true,
    };
  }

  async function acquireResourceSource(
    intent: BulkPublicationIntent,
    rowId: string,
    resourceKind: BulkPublicationResourceStepKind,
    expectation: Home2SourceExpectation | null,
    missingExpectationError: { code: string; message: string },
  ): Promise<Home2RowAcquisitionResult> {
    validateRoleIntent(intent);
    const row = findRow(intent, rowId);

    if (!row) {
      return {
        batchId: intent.batchId,
        sources: [],
        failedRows: [
          acquisitionFailure(intent.batchId, rowId, 0, {
            code: 'ROW_NOT_FOUND',
            message: 'The staged row no longer exists.',
            retryable: false,
          }),
        ],
        canceled: false,
      };
    }

    if (!expectation) {
      return {
        batchId: intent.batchId,
        sources: [],
        failedRows: [
          acquisitionFailure(intent.batchId, rowId, row.sourceGeneration, {
            code: missingExpectationError.code,
            message: missingExpectationError.message,
            retryable: false,
          }),
        ],
        canceled: false,
      };
    }

    const key = resourceKey(intent.batchId, rowId, row.sourceGeneration, resourceKind);
    const existing = state.handles.get(key);

    if (existing && !existing.consumed && handleMatchesExpectation(existing, expectation)) {
      return {
        batchId: intent.batchId,
        sources: [handleDescriptor(existing)],
        failedRows: [],
        canceled: false,
      };
    }

    if (existing && !existing.consumed) {
      state.handles.delete(key);
    }

    if (state.hostPlatform === 'android') {
      for (const active of state.handles.values()) {
        if (!active.consumed) {
          throw new Home2AndroidSequentialAcquisitionRequiredError();
        }
      }
    }

    let raw: unknown;
    try {
      raw = await requestUnwrapped(transport, { action: ACTION_SELECT, kind: 'file' });
    } catch (error) {
      return {
        batchId: intent.batchId,
        sources: [],
        failedRows: [
          acquisitionFailure(
            intent.batchId,
            rowId,
            row.sourceGeneration,
            classifyError(error, ACTION_SELECT),
          ),
        ],
        canceled: false,
      };
    }

    const selected = normalizeSourceDescriptor(raw);

    if (!selected) {
      return {
        batchId: intent.batchId,
        sources: [],
        failedRows: [
          acquisitionFailure(intent.batchId, rowId, row.sourceGeneration, {
            code: 'MALFORMED_SOURCE_DESCRIPTOR',
            message: 'Home returned a malformed native source descriptor.',
            retryable: false,
          }),
        ],
        canceled: false,
      };
    }

    if (selected.canceled) {
      return { batchId: intent.batchId, sources: [], failedRows: [], canceled: true };
    }

    const candidate = {
      fileName: selected.fileName,
      mimeType: selected.mimeType ?? '',
      sizeBytes: selected.size,
    };

    if (!expectedDescriptorsMatch(expectation, candidate)) {
      return {
        batchId: intent.batchId,
        sources: [],
        failedRows: [
          acquisitionFailure(intent.batchId, rowId, row.sourceGeneration, {
            code: 'SOURCE_MISMATCH',
            message: `The selected native ${resourceKind} file does not match the staged ${resourceKind}.`,
            retryable: false,
          }),
        ],
        canceled: false,
      };
    }

    const handle: Home2SourceHandle = {
      batchId: intent.batchId,
      rowId,
      sourceGeneration: row.sourceGeneration,
      resourceKind,
      handleId: generateId(),
      sourceToken: selected.sourceToken,
      fileName: selected.fileName,
      mimeType: selected.mimeType ?? '',
      sizeBytes: selected.size,
      acquiredAt: now(),
      consumed: false,
    };

    state.handles.set(key, handle);

    return {
      batchId: intent.batchId,
      sources: [handleDescriptor(handle)],
      failedRows: [],
      canceled: false,
    };
  }

  async function acquireRowSource(
    intent: BulkPublicationIntent,
    rowId: string,
  ): Promise<Home2RowAcquisitionResult> {
    const row = findRow(intent, rowId);
    return acquireResourceSource(intent, rowId, 'audio', audioExpectation(row?.source ?? null), {
      code: 'SOURCE_UNAVAILABLE',
      message: 'The staged audio source must be re-selected.',
    });
  }

  async function acquireCoverSource(
    intent: BulkPublicationIntent,
    rowId: string,
  ): Promise<Home2RowAcquisitionResult> {
    const row = findRow(intent, rowId);
    return acquireResourceSource(intent, rowId, 'cover', row ? coverExpectation(row) : null, {
      code: 'COVER_NOT_REQUIRED',
      message: 'This Track has no cover, so no cover publication is required.',
    });
  }

  async function acquireMetadataSource(
    intent: BulkPublicationIntent,
    rowId: string,
    expected: BulkImportLocalSourceDescriptor,
  ): Promise<Home2RowAcquisitionResult> {
    const row = findRow(intent, rowId);
    return acquireResourceSource(
      intent,
      rowId,
      'metadata',
      row ? sourceDescriptorToExpectation(expected) : null,
      {
        code: 'METADATA_EXPORT_UNAVAILABLE',
        message: 'Export the metadata JSON before selecting it in Home.',
      },
    );
  }

  async function acquirePublicationSources(
    intent: BulkPublicationIntent,
  ): Promise<BulkPublicationAcquisitionResult> {
    validateRoleIntent(intent);

    if (state.hostPlatform === 'android' && intent.rows.length > 1) {
      throw new Home2AndroidSequentialAcquisitionRequiredError();
    }

    const sources: BulkPublicationSourceDescriptor[] = [];
    const failedRows: BulkPublicationAcquisitionResult['failedRows'] = [];

    for (const row of intent.rows) {
      const result = await acquireRowSource(intent, row.rowId);
      sources.push(...result.sources);
      failedRows.push(...result.failedRows);
    }

    return { batchId: intent.batchId, sources, failedRows };
  }

  function resolveHandle(
    intent: BulkPublicationIntent,
    source: BulkPublicationSourceDescriptor,
    resourceKind: BulkPublicationResourceStepKind,
  ): Home2SourceHandle {
    const row = findRow(intent, source.rowId);
    if (!row || row.sourceGeneration !== source.sourceGeneration) {
      throw new Error(`Source is bound to an unknown or stale row ${source.rowId}.`);
    }

    const key = resourceKey(intent.batchId, source.rowId, source.sourceGeneration, resourceKind);
    const handle = state.handles.get(key);
    if (!handle || handle.consumed) {
      throw new Error(`No active native source handle exists for row ${source.rowId}.`);
    }
    if (
      handle.batchId !== intent.batchId ||
      handle.resourceKind !== resourceKind ||
      handle.handleId !== source.handleId
    ) {
      throw new Error(`Stale native source handle supplied for row ${source.rowId}.`);
    }
    if (
      handle.fileName !== source.fileName ||
      handle.mimeType !== source.mimeType ||
      handle.sizeBytes !== source.sizeBytes
    ) {
      throw new Error(`Native source descriptor mismatch for row ${source.rowId}.`);
    }

    return handle;
  }

  function pendingResourceIntent(
    resourceKind: BulkPublicationResourceStepKind,
    publisherName: string,
  ): BulkImportPublicationResourceIdentity {
    return {
      kind: resourceKind,
      service: resourceKind === 'audio' ? 'AUDIO' : resourceKind === 'cover' ? 'IMAGE' : 'JSON',
      name: publisherName || 'pending',
      identifier: `pending-${resourceKind}`,
    };
  }

  function buildResourceIntent(
    intent: BulkPublicationIntent,
    row: BulkPublicationRowIntent,
    resourceKind: BulkPublicationResourceStepKind,
  ): BulkImportPublicationResourceIdentity {
    const publisherName = asNonEmptyString(intent.actor.name);
    if (!publisherName) {
      throw new Error(`A registered publisher name is required to publish ${resourceKind}.`);
    }

    if (resourceKind === 'audio') {
      return {
        kind: 'audio',
        service: 'AUDIO',
        name: publisherName,
        identifier:
          row.roleIntent === 'submission'
            ? getSubmissionAudioQdnIdentifier(row.rowId)
            : getAudioQdnIdentifier(),
      };
    }

    if (resourceKind === 'cover') {
      return {
        kind: 'cover',
        service: 'IMAGE',
        name: publisherName,
        identifier:
          row.roleIntent === 'submission'
            ? getSubmissionCoverQdnIdentifier(row.rowId)
            : getCoverQdnIdentifier(),
      };
    }

    return {
      kind: 'metadata',
      service: 'JSON',
      name: publisherName,
      identifier:
        row.roleIntent === 'submission'
          ? getSubmissionQdnIdentifier(row.rowId)
          : getTrackQdnIdentifier(row.rowId),
    };
  }

  function requiredResourceRevision(
    row: BulkPublicationRowIntent,
    resourceKind: BulkPublicationResourceStepKind,
  ): string {
    return (
      getRequiredPublicationContentRevision(resourceKind, {
        sourceGeneration: row.sourceGeneration,
        source: row.source,
        metadata: row.metadata,
        cover: row.cover ? { ...row.cover, previewUrl: null } : null,
      }) ?? `missing-${resourceKind}-revision`
    );
  }

  function resourceDependencyError(
    row: BulkPublicationRowIntent,
    resourceKind: BulkPublicationResourceStepKind,
  ): BulkImportPublicationError | null {
    if (resourceKind === 'audio') return null;

    const audioRevision = computeAudioContentRevision(row.source, row.sourceGeneration);
    const audioConfirmed =
      audioRevision !== null &&
      isPublishedPublicationStep(row.publication.audio) &&
      row.publication.audio.contentRevision === audioRevision &&
      row.publication.audio.intent.kind === 'audio';

    if (!audioConfirmed) {
      return {
        code: 'AUDIO_DEPENDENCY_NOT_READY',
        message: 'Publish AUDIO for the current source before publishing this resource.',
        retryable: false,
      };
    }

    if (resourceKind === 'cover') return null;

    if (row.cover !== null) {
      const coverRevision = computeCoverContentRevision(
        row.cover ? { ...row.cover, previewUrl: null } : null,
      );
      const coverConfirmed =
        coverRevision !== null &&
        isPublishedPublicationStep(row.publication.cover) &&
        row.publication.cover.contentRevision === coverRevision &&
        row.publication.cover.intent.kind === 'cover';

      if (!coverConfirmed) {
        return {
          code: 'COVER_DEPENDENCY_NOT_READY',
          message: 'Publish COVER for the current cover before publishing metadata.',
          retryable: false,
        };
      }
    }

    return null;
  }

  function currentHandleExpectation(
    row: BulkPublicationRowIntent,
    resourceKind: BulkPublicationResourceStepKind,
    expectedMetadata?: BulkImportLocalSourceDescriptor,
  ): Home2SourceExpectation | null {
    if (resourceKind === 'audio') return audioExpectation(row.source);
    if (resourceKind === 'cover') return coverExpectation(row);
    if (resourceKind === 'metadata' && expectedMetadata) {
      return sourceDescriptorToExpectation(expectedMetadata);
    }
    return null;
  }

  async function publishResourceRow(
    intent: BulkPublicationIntent,
    source: BulkPublicationSourceDescriptor,
    resourceKind: BulkPublicationResourceStepKind,
    expectedMetadata?: BulkImportLocalSourceDescriptor,
  ): Promise<BulkPublicationRowResult> {
    validateRoleIntent(intent);
    const row = findRow(intent, source.rowId);
    if (!row || row.sourceGeneration !== source.sourceGeneration) {
      throw new Error(`Source is bound to an unknown or stale row ${source.rowId}.`);
    }

    const handle = resolveHandle(intent, source, resourceKind);
    const contentRevision = requiredResourceRevision(row, resourceKind);
    let resourceIntent: BulkImportPublicationResourceIdentity;

    try {
      resourceIntent = buildResourceIntent(intent, row, resourceKind);
    } catch (error) {
      return {
        batchId: intent.batchId,
        rowId: row.rowId,
        sourceGeneration: row.sourceGeneration,
        status: 'failed',
        steps: [
          makeFailedResult(
            intent,
            row,
            pendingResourceIntent(resourceKind, intent.actor.name ?? ''),
            contentRevision,
            {
              code: 'PUBLISHER_NAME_REQUIRED',
              message: errorMessage(error, 'A registered publisher name is required.'),
              retryable: false,
            },
          ),
        ],
      };
    }

    const expectation = currentHandleExpectation(row, resourceKind, expectedMetadata);
    if (expectation && !handleMatchesExpectation(handle, expectation)) {
      return {
        batchId: intent.batchId,
        rowId: row.rowId,
        sourceGeneration: row.sourceGeneration,
        status: 'failed',
        steps: [
          makeFailedResult(intent, row, resourceIntent, contentRevision, {
            code: 'SOURCE_STALE',
            message: 'The selected native source no longer matches the current row revision.',
            retryable: false,
          }),
        ],
      };
    }

    const dependencyError = resourceDependencyError(row, resourceKind);
    if (dependencyError) {
      return {
        batchId: intent.batchId,
        rowId: row.rowId,
        sourceGeneration: row.sourceGeneration,
        status: 'failed',
        steps: [makeFailedResult(intent, row, resourceIntent, contentRevision, dependencyError)],
      };
    }

    const step = row.publication[resourceKind];
    if (
      isPublishedPublicationStep(step) &&
      step.contentRevision === contentRevision &&
      step.intent.kind === resourceKind
    ) {
      return {
        batchId: intent.batchId,
        rowId: row.rowId,
        sourceGeneration: row.sourceGeneration,
        status: 'no-op',
        steps: [
          {
            status: 'skipped',
            reason: 'already-confirmed',
            batchId: intent.batchId,
            rowId: row.rowId,
            sourceGeneration: row.sourceGeneration,
            step: resourceKind,
            intent: step.intent,
            contentRevision,
            confirmed: step.confirmed,
            confirmedAt: step.confirmedAt,
          },
        ],
      };
    }

    if (isUnknownPublicationStep(step) && step.contentRevision === contentRevision) {
      throw new Home2ReconciliationRequiredError(
        step.attempt.attemptId,
        `${resourceKind.toUpperCase()} publication has an unknown outcome. Reconcile attempt ${
          step.attempt.attemptId
        } before retrying.`,
      );
    }

    const request = {
      action: ACTION_PUBLISH,
      sourceToken: handle.sourceToken,
      service: resourceIntent.service,
      name: resourceIntent.name,
      identifier: resourceIntent.identifier,
    };

    let raw: unknown;
    try {
      raw = await requestUnwrapped(transport, request);
    } catch (error) {
      const classified = classifyError(error, ACTION_PUBLISH);
      if (isTerminalSourceError(classified.code)) {
        handle.consumed = true;
      }

      return {
        batchId: intent.batchId,
        rowId: row.rowId,
        sourceGeneration: row.sourceGeneration,
        status: 'failed',
        steps: [makeFailedResult(intent, row, resourceIntent, contentRevision, classified)],
      };
    }

    const publishResult = parsePublishResult(raw);
    if (!publishResult.ok) {
      handle.consumed = isTerminalSourceError(publishResult.error.code);
      return {
        batchId: intent.batchId,
        rowId: row.rowId,
        sourceGeneration: row.sourceGeneration,
        status: 'failed',
        steps: [
          makeFailedResult(intent, row, resourceIntent, contentRevision, publishResult.error),
        ],
      };
    }

    const reference = publishResult.reference;
    if (!referenceMatchesIntent(reference, resourceIntent)) {
      handle.consumed = false;
      return {
        batchId: intent.batchId,
        rowId: row.rowId,
        sourceGeneration: row.sourceGeneration,
        status: 'failed',
        steps: [
          makeFailedResult(intent, row, resourceIntent, contentRevision, {
            code: 'RESULT_TARGET_MISMATCH',
            message: 'Home returned a publication result for a different resource target.',
            retryable: false,
          }),
        ],
      };
    }

    if (
      publishResult.source &&
      (publishResult.source.fileName !== handle.fileName ||
        publishResult.source.size !== handle.sizeBytes)
    ) {
      handle.consumed = false;
      return {
        batchId: intent.batchId,
        rowId: row.rowId,
        sourceGeneration: row.sourceGeneration,
        status: 'failed',
        steps: [
          makeFailedResult(intent, row, resourceIntent, contentRevision, {
            code: 'RESULT_TARGET_MISMATCH',
            message: 'Home returned publication evidence for a different native source.',
            retryable: false,
          }),
        ],
      };
    }

    if (publishResult.outcome === 'unknown') {
      handle.consumed = true;
      return {
        batchId: intent.batchId,
        rowId: row.rowId,
        sourceGeneration: row.sourceGeneration,
        status: 'unknown',
        steps: [
          makeUnknownResult(
            intent,
            row,
            resourceIntent,
            contentRevision,
            publishResult.transactionSignature,
          ),
        ],
      };
    }

    handle.consumed = true;
    return {
      batchId: intent.batchId,
      rowId: row.rowId,
      sourceGeneration: row.sourceGeneration,
      status: resourceKind === 'metadata' ? 'complete' : 'partial',
      steps: [
        {
          status: 'published',
          batchId: intent.batchId,
          rowId: row.rowId,
          sourceGeneration: row.sourceGeneration,
          step: resourceKind,
          intent: resourceIntent,
          contentRevision,
          attemptId: publishResult.transactionSignature,
          reference,
          confirmedContentRevision: contentRevision,
          transactionSignature: publishResult.transactionSignature,
          confirmedAt: now(),
        },
      ],
    };
  }

  async function publishRow(
    intent: BulkPublicationIntent,
    source: BulkPublicationSourceDescriptor,
  ): Promise<BulkPublicationRowResult> {
    return publishResourceRow(intent, source, 'audio');
  }

  async function publishCover(
    intent: BulkPublicationIntent,
    source: BulkPublicationSourceDescriptor,
  ): Promise<BulkPublicationRowResult> {
    return publishResourceRow(intent, source, 'cover');
  }

  async function publishMetadata(
    intent: BulkPublicationIntent,
    source: BulkPublicationSourceDescriptor,
    expectedMetadata?: BulkImportLocalSourceDescriptor,
  ): Promise<BulkPublicationRowResult> {
    return publishResourceRow(intent, source, 'metadata', expectedMetadata);
  }

  async function publishBatch(
    intent: BulkPublicationIntent,
    sources: readonly BulkPublicationSourceDescriptor[],
  ): Promise<BulkPublicationBatchResult> {
    validateRoleIntent(intent);

    if (state.hostPlatform === 'android' && sources.length > 1) {
      throw new Home2AndroidSequentialAcquisitionRequiredError();
    }

    const rows: BulkPublicationRowResult[] = [];
    for (const source of sources) {
      rows.push(await publishRow(intent, source));
    }

    return {
      batchId: intent.batchId,
      rows,
      publishedCount: rows.filter((row) => row.status === 'partial' || row.status === 'complete')
        .length,
      failedCount: rows.filter((row) => row.status === 'failed').length,
      unknownCount: rows.filter((row) => row.status === 'unknown').length,
    };
  }

  async function reconcileBatch(): Promise<BulkPublicationBatchResult> {
    throw new Error('A2 reconciliation is deferred to A2-5 and is not implemented in this pass.');
  }

  function dispose(): void {
    state.handles.clear();
  }

  return {
    capability: () => state.capability,
    acquirePublicationSources,
    publishBatch,
    reconcileBatch,
    detectCapability,
    getHostPlatform,
    acquireRowSource,
    acquireCoverSource,
    acquireMetadataSource,
    publishRow,
    publishCover,
    publishMetadata,
    dispose,
  };
}

function isTerminalSourceError(code: string): boolean {
  return new Set([
    'SOURCE_EXPIRED',
    'SOURCE_CONSUMED',
    'SOURCE_BINDING_MISMATCH',
    'SOURCE_INVALID',
    'MALFORMED_PUBLISH_REQUEST',
  ]).has(code);
}

function parsePublishResult(raw: unknown):
  | {
      ok: true;
      outcome: 'accepted' | 'unknown';
      reference: BulkImportPublicationReference;
      source: { fileName: string; size: number } | null;
      transactionSignature: string;
    }
  | { ok: false; error: BulkImportPublicationError } {
  if (!isRecord(raw)) {
    return {
      ok: false,
      error: {
        code: 'MALFORMED_PUBLISH_RESULT',
        message: 'Home returned a malformed publication result.',
        retryable: false,
      },
    };
  }

  const accepted = raw.accepted === true;
  const outcome = raw.outcome === 'unknown' ? 'unknown' : accepted ? 'accepted' : null;
  const transactionSignature = asNonEmptyString(raw.transactionSignature);
  const resource = isRecord(raw.resource) ? raw.resource : null;
  const source = isRecord(raw.source) ? raw.source : null;
  const reference = resource ? normalizeReference(resource) : null;

  if (!outcome) {
    return {
      ok: false,
      error: {
        code: 'MALFORMED_PUBLISH_RESULT',
        message: 'Home did not return an accepted or signed-unknown publication outcome.',
        retryable: false,
      },
    };
  }

  if (!transactionSignature) {
    return {
      ok: false,
      error: {
        code: 'MALFORMED_PUBLISH_RESULT',
        message: 'Home publication result is missing its transaction signature.',
        retryable: false,
      },
    };
  }

  if (!reference) {
    return {
      ok: false,
      error: {
        code: 'MALFORMED_PUBLISH_RESULT',
        message: 'Home publication result is missing its resource coordinate.',
        retryable: false,
      },
    };
  }

  if (outcome === 'unknown' && raw.errorType !== 'BROADCAST_UNKNOWN') {
    return {
      ok: false,
      error: {
        code: 'MALFORMED_UNKNOWN_RESULT',
        message: 'Signed-unknown publication result is missing BROADCAST_UNKNOWN evidence.',
        retryable: false,
      },
    };
  }

  const sourceFileName = source ? asNonEmptyString(source.fileName) : null;
  const sourceSize =
    source && typeof source.size === 'number' && Number.isSafeInteger(source.size)
      ? source.size
      : null;

  if (source && (!sourceFileName || sourceSize === null)) {
    return {
      ok: false,
      error: {
        code: 'MALFORMED_PUBLISH_RESULT',
        message: 'Home publication result source evidence is incomplete.',
        retryable: false,
      },
    };
  }

  return {
    ok: true,
    outcome,
    reference,
    source:
      sourceFileName && sourceSize !== null ? { fileName: sourceFileName, size: sourceSize } : null,
    transactionSignature,
  };
}

export { detectHome2Capability };
