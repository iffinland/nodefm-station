/* ============================================================
 * NodeFM Station — Qortium Bridge (Phase 2 Extensions)
 *
 * Phase 2 QDN operations: publish, search, list, resource URL,
 * status, metadata, source selection.
 *
 * All raw Qortium interaction is centralized here.
 * React components must not construct raw bridge payloads.
 * ============================================================ */

import { sendBridgeRequest } from './bridge';
import type { QdnResourceRef } from '../types/domain';
import { resolveQdnPublishFilename } from './publishFilename';
import { requireAccountWrite } from './accountWriteGate';
import { QdnResourceReadError, isConfirmedQdnNotFoundError } from './qdnReadError';

// ── Publish ─────────────────────────────────────────────────────────
//
// Qortium Home 2.1 publishing contract: a publish request carries only a
// Home-issued `sourceToken` plus mutable metadata. Home refuses inline bytes
// and path-shaped fields (`data64`, `base64`, `filename`, `mimeType`, `file`,
// `path`, ...) and derives the fee itself, so NodeFM never emits them.
//
// App-held bytes are handed to `STAGE_QDN_PUBLISH_SOURCE`, which returns an
// ordinary Home source token bound to the app, tab, account, node route and
// route revision (30-minute TTL). Staging grants nothing by itself: the publish
// action still runs Home's normal approval prompt.
//
// Root cause and contract evidence: the 2026-09-16 NodeFM Home 2.1
// compatibility audit and the pinned Home v2.1.0-beta.11 source.

/** Publish-source acquisition Home can perform for this app. */
export type QdnPublishSourceKind = 'stage' | 'select';

const ACTION_SHOW_ACTIONS = 'SHOW_ACTIONS';
export const ACTION_SELECT_PUBLISH_SOURCE = 'SELECT_QDN_PUBLISH_SOURCE';
export const ACTION_STAGE_PUBLISH_SOURCE = 'STAGE_QDN_PUBLISH_SOURCE';
export const ACTION_PUBLISH_RESOURCE = 'PUBLISH_QDN_RESOURCE';
export const ACTION_PUBLISH_MULTIPLE_RESOURCES = 'PUBLISH_MULTIPLE_QDN_RESOURCES';

/**
 * Fields Home 2 refuses on a publish request. Checked defensively at the wire
 * boundary so a refused encoding can never leave NodeFM again.
 */
const REFUSED_PUBLISH_FIELDS = [
  'base64',
  'bytes',
  'bytesBase64',
  'data',
  'data64',
  'dataBase64',
  'fee',
  'file',
  'fileName',
  'filePath',
  'filename',
  'filepath',
  'mimeType',
  'path',
  'source',
  'sourceBase64',
  'uri',
] as const;

/** Legacy publish inputs NodeFM must not accept again. */
const REFUSED_PUBLISH_INPUT_FIELDS = [
  'base64',
  'data',
  'data64',
  'dataBase64',
  'fee',
  'file',
  'filePath',
  'filename',
  'filepath',
  'path',
  'source',
  'sourceBase64',
  'uri',
] as const;

/**
 * Source for one publish item.
 *
 * Exactly one acquisition path is used per item:
 * - `sourceToken` — already issued by Home (native picker or an earlier stage);
 * - `bytesBase64` + `fileName` — app-held bytes staged by this boundary.
 *
 * `mimeType` is bound to the staged blob only; it is never published.
 */
export type QdnPublishSourceInput = {
  /** Home-issued source token from SELECT_QDN_PUBLISH_SOURCE or staging. */
  sourceToken?: string;
  /** App-held bytes (base64) that this boundary stages before publishing. */
  bytesBase64?: string;
  /** Filename bound to the staged bytes. Required with `bytesBase64`. */
  fileName?: string;
  /** MIME type bound to the staged bytes. Never sent on a publish request. */
  mimeType?: string;
};

export type PublishInput = QdnPublishSourceInput & {
  /** QDN service name (e.g. 'AUDIO', 'IMAGE', 'JSON', 'PLAYLIST') */
  service: string;
  /** Publishing name (unique per service + identifier) */
  name: string;
  /** Optional identifier (use 'default' for standard) */
  identifier?: string;
  /** Human-readable title */
  title?: string;
  /** Description */
  description?: string;
  /** Category */
  category?: string;
  /** Tags */
  tags?: string[];
};

export type PublishMultipleResource = PublishInput;

export type PublishResult = {
  accepted: boolean;
  action: string;
  resource: {
    identifier: string | null;
    name: string;
    service: string;
  };
  transactionSignature?: string;
};

export type MultiplePublishResourceCoordinate = {
  identifier: string | null;
  name: string;
  service: string;
};

export type MultiplePublishPublishedResource = {
  result: unknown;
  resource: MultiplePublishResourceCoordinate;
  transactionSignature: string;
};

export type MultiplePublishFailedResource = {
  error: string;
  /**
   * Present when Home signed the transaction but could not confirm the
   * broadcast outcome. Such an item must be reconciled, never blindly
   * re-published.
   */
  errorType?: string;
  outcome?: 'unknown';
  resource: MultiplePublishResourceCoordinate;
  transactionSignature?: string;
};

export type MultiplePublishResult = {
  accepted: boolean;
  action: string;
  published: MultiplePublishPublishedResource[];
  failures: MultiplePublishFailedResource[];
};

/** Home 2's per-request batch ceiling. Larger operations are chunked. */
export const QDN_PUBLISH_BATCH_MAX_ITEMS = 10;

export type QdnPublishCapability = {
  status: 'available' | 'unsupported' | 'unknown';
  stageSource: boolean;
  selectSource: boolean;
  publish: boolean;
  publishMultiple: boolean;
  /** The action names Home advertised, or null when SHOW_ACTIONS failed. */
  advertisedActions: readonly string[] | null;
};

/**
 * Raised when the runtime does not advertise the Home 2 stage/token
 * publishing actions. NodeFM fails closed instead of falling back to the
 * refused Home 1.x inline contract.
 */
export class QdnPublishSourceUnsupportedError extends Error {
  readonly action: string;

  constructor(action: string, advertisedActions: readonly string[] | null) {
    super(
      `This Qortium Home runtime does not advertise ${action}. NodeFM publishes only ` +
        'through the Home 2 stage/token contract: app-held bytes are staged with ' +
        'STAGE_QDN_PUBLISH_SOURCE and published with a Home-issued sourceToken. ' +
        'NodeFM does not fall back to the legacy Home 1.x inline data64/filename ' +
        `contract, which Home 2 refuses.${
          advertisedActions
            ? ''
            : ' SHOW_ACTIONS returned no action list, so the runtime cannot be identified.'
        }`,
    );
    this.name = 'QdnPublishSourceUnsupportedError';
    this.action = action;
  }
}

let cachedAdvertisedActions: ReadonlySet<string> | null = null;
let inFlightAdvertisedActions: Promise<ReadonlySet<string> | null> | null = null;

/** Drop the cached SHOW_ACTIONS result (account/route change, tests). */
export function resetQdnPublishCapabilityCache(): void {
  cachedAdvertisedActions = null;
  inFlightAdvertisedActions = null;
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

export async function getQdnPublishCapability(): Promise<QdnPublishCapability> {
  const actions = await loadAdvertisedActions();
  const has = (action: string) => Boolean(actions?.has(action));

  return {
    status: actions ? (has(ACTION_STAGE_PUBLISH_SOURCE) ? 'available' : 'unsupported') : 'unknown',
    stageSource: has(ACTION_STAGE_PUBLISH_SOURCE),
    selectSource: has(ACTION_SELECT_PUBLISH_SOURCE),
    publish: has(ACTION_PUBLISH_RESOURCE),
    publishMultiple: has(ACTION_PUBLISH_MULTIPLE_RESOURCES),
    advertisedActions: actions ? [...actions] : null,
  };
}

export async function isQdnPublishSourceSupported(kind: QdnPublishSourceKind): Promise<boolean> {
  const actions = await loadAdvertisedActions();

  return actions?.has(kind === 'stage' ? ACTION_STAGE_PUBLISH_SOURCE : ACTION_SELECT_PUBLISH_SOURCE)
    ? true
    : false;
}

async function requireQdnPublishSourceSupported(kind: QdnPublishSourceKind): Promise<void> {
  const action = kind === 'stage' ? ACTION_STAGE_PUBLISH_SOURCE : ACTION_SELECT_PUBLISH_SOURCE;

  if (await isQdnPublishSourceSupported(kind)) return;

  throw new QdnPublishSourceUnsupportedError(action, null);
}

function assertNoLegacyPublishInput(value: object, action: string): void {
  const record = value as Record<string, unknown>;

  for (const field of REFUSED_PUBLISH_INPUT_FIELDS) {
    const candidate = record[field];

    if (candidate !== undefined && candidate !== null && candidate !== '') {
      throw new Error(
        `${action} does not accept ${field}: NodeFM publishes through the Home 2 ` +
          'stage/token contract only.',
      );
    }
  }
}

function assertCleanPublishPayload(payload: Record<string, unknown>, action: string): void {
  for (const field of REFUSED_PUBLISH_FIELDS) {
    const candidate = payload[field];

    if (candidate !== undefined && candidate !== null && candidate !== '') {
      throw new Error(
        `${action} payload must be token-only: ${field} is refused by Home 2 publishing.`,
      );
    }
  }
}

function coordinateOf(
  resource: Pick<PublishInput, 'identifier' | 'name' | 'service'>,
): MultiplePublishResourceCoordinate {
  return {
    identifier: resource.identifier ?? null,
    name: resource.name,
    service: resource.service,
  };
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function buildPublishRequestPayload(
  resource: PublishInput,
  sourceToken: string,
  action: string,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    action,
    service: resource.service,
    name: resource.name,
    sourceToken,
  };

  if (resource.identifier) payload.identifier = resource.identifier;
  if (resource.title) payload.title = resource.title;
  if (resource.description) payload.description = resource.description;
  if (resource.category) payload.category = resource.category;
  if (resource.tags?.length) payload.tags = resource.tags;

  assertCleanPublishPayload(payload, action);

  return payload;
}

/**
 * Hand app-held bytes to Home and return the Home-issued source token.
 *
 * The publish source is a blob (`kind: 'blob'`) held in Home's bounded source
 * store until the publish prompt is approved or the token expires.
 */
export type StageQdnPublishSourceInput = {
  bytesBase64: string;
  fileName: string;
  mimeType?: string;
};

export type StageQdnPublishSourceResult = {
  sourceToken: string;
  fileName: string;
  kind: string;
  size: number;
  mimeType?: string | null;
};

export async function stageQdnPublishSource(
  input: StageQdnPublishSourceInput,
): Promise<StageQdnPublishSourceResult> {
  const bytesBase64 = input.bytesBase64?.trim() ?? '';
  const fileName = input.fileName?.trim() ?? '';

  if (!bytesBase64) {
    throw new Error('App-held bytes (bytesBase64) are required to stage a publish source.');
  }

  if (!fileName) {
    throw new Error('A fileName is required to stage a publish source.');
  }

  await requireQdnPublishSourceSupported('stage');

  // Home 2.1 sanitizes the staged name itself (leaf-only, bounded length) and
  // preserves Unicode, so the original filename is what Home publishes. NodeFM
  // only rejects path/control input; it never transliterates or ASCII-normalizes
  // a source filename (Home issue #330 / PR #337).
  const stagedFileName = resolveQdnPublishFilename(fileName).staged;

  const result = (await sendBridgeRequest({
    action: ACTION_STAGE_PUBLISH_SOURCE,
    bytesBase64,
    fileName: stagedFileName,
    ...(input.mimeType ? { mimeType: input.mimeType } : {}),
  })) as unknown;

  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('STAGE_QDN_PUBLISH_SOURCE returned a malformed source descriptor.');
  }

  const descriptor = result as Record<string, unknown>;
  const sourceToken =
    typeof descriptor.sourceToken === 'string' ? descriptor.sourceToken.trim() : '';

  if (!sourceToken) {
    throw new Error('STAGE_QDN_PUBLISH_SOURCE did not return a Home-issued sourceToken.');
  }

  return {
    sourceToken,
    fileName: typeof descriptor.fileName === 'string' ? descriptor.fileName : stagedFileName,
    kind: typeof descriptor.kind === 'string' ? descriptor.kind : 'blob',
    size: typeof descriptor.size === 'number' ? descriptor.size : 0,
    mimeType:
      typeof descriptor.mimeType === 'string' || descriptor.mimeType === null
        ? (descriptor.mimeType as string | null)
        : undefined,
  };
}

async function resolvePublishSourceToken(resource: PublishInput): Promise<string> {
  const sourceToken = resource.sourceToken?.trim();

  if (sourceToken) return sourceToken;

  const bytesBase64 = resource.bytesBase64?.trim();

  if (!bytesBase64) {
    throw new Error(
      'A Home-issued sourceToken or app-held bytes are required to publish a QDN resource.',
    );
  }

  const staged = await stageQdnPublishSource({
    bytesBase64,
    fileName: resource.fileName?.trim() ?? '',
    ...(resource.mimeType ? { mimeType: resource.mimeType } : {}),
  });

  return staged.sourceToken;
}

/**
 * Publish one QDN resource through the Home 2 stage/token contract.
 *
 * A caller either passes an already-issued `sourceToken` (native picker) or
 * app-held `bytesBase64`, which this boundary stages first. The publish
 * request itself is always token-only.
 */
export async function publishResource(input: PublishInput): Promise<PublishResult> {
  assertNoLegacyPublishInput(input, ACTION_PUBLISH_RESOURCE);
  await requireAccountWrite(ACTION_PUBLISH_RESOURCE);

  const sourceToken = await resolvePublishSourceToken(input);
  const payload = buildPublishRequestPayload(input, sourceToken, ACTION_PUBLISH_RESOURCE);

  return sendBridgeRequest(payload) as Promise<PublishResult>;
}

function normalizePublishResponse(raw: unknown, action: string): MultiplePublishResult {
  const record =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};

  const published = Array.isArray(record.published)
    ? (record.published as MultiplePublishPublishedResource[])
    : [];
  const failures = Array.isArray(record.failures)
    ? (record.failures as MultiplePublishFailedResource[])
    : [];

  return {
    ...(record as Omit<MultiplePublishResult, 'published' | 'failures'>),
    accepted: record.accepted === true,
    action: typeof record.action === 'string' ? record.action : action,
    published: [...published],
    failures: [...failures],
  };
}

function chunkResources(
  resources: readonly PublishMultipleResource[],
): PublishMultipleResource[][] {
  const chunks: PublishMultipleResource[][] = [];

  for (let index = 0; index < resources.length; index += QDN_PUBLISH_BATCH_MAX_ITEMS) {
    chunks.push(resources.slice(index, index + QDN_PUBLISH_BATCH_MAX_ITEMS));
  }

  return chunks;
}

/**
 * Publish several QDN resources through the Home 2 batch contract.
 *
 * Each request carries at most `QDN_PUBLISH_BATCH_MAX_ITEMS` token-only items
 * with distinct source tokens, so larger logical operations are chunked. Home
 * publishes each item as its own QDN transaction; the result therefore has
 * explicit `published` and `failures` arrays and must not be treated as atomic.
 *
 * Items Home signed without confirming a broadcast carry `outcome: 'unknown'`.
 * They are reported as failures and must be reconciled, never blindly
 * re-published.
 */
export async function publishMultipleResources(
  resources: readonly PublishMultipleResource[],
): Promise<MultiplePublishResult> {
  if (resources.length === 0) {
    throw new Error('At least one resource is required for QDN batch publication.');
  }

  await requireAccountWrite(ACTION_PUBLISH_MULTIPLE_RESOURCES);

  const chunks = chunkResources(resources);
  const published: MultiplePublishPublishedResource[] = [];
  const failures: MultiplePublishFailedResource[] = [];
  let extra: Record<string, unknown> = {};
  let firstResponse = true;

  for (const chunk of chunks) {
    const ready: Array<{ resource: PublishMultipleResource; sourceToken: string }> = [];

    for (const resource of chunk) {
      assertNoLegacyPublishInput(resource, ACTION_PUBLISH_MULTIPLE_RESOURCES);

      try {
        ready.push({ resource, sourceToken: await resolvePublishSourceToken(resource) });
      } catch (error) {
        failures.push({
          error: errorMessage(error, 'QDN publish source preparation failed.'),
          resource: coordinateOf(resource),
        });
      }
    }

    if (ready.length === 0) {
      // Single logical publication: fail closed with the real preparation
      // error. Chunked operations keep going and report the item failures.
      if (chunks.length === 1) {
        throw new Error(failures[0]?.error ?? 'No QDN publish source could be prepared.');
      }

      firstResponse = false;
      continue;
    }

    let response: MultiplePublishResult;

    try {
      response = normalizePublishResponse(
        await sendBridgeRequest({
          action: ACTION_PUBLISH_MULTIPLE_RESOURCES,
          resources: ready.map(({ resource, sourceToken }) =>
            buildPublishRequestPayload(resource, sourceToken, ACTION_PUBLISH_MULTIPLE_RESOURCES),
          ),
        }),
        ACTION_PUBLISH_MULTIPLE_RESOURCES,
      );
    } catch (error) {
      // Nothing has been published yet: preserve the previous single-request
      // behaviour and surface the bridge failure directly.
      if (firstResponse && published.length === 0) throw error;

      const message = errorMessage(error, 'QDN batch publication chunk failed.');

      for (const { resource } of ready) {
        failures.push({ error: message, resource: coordinateOf(resource) });
      }

      firstResponse = false;
      continue;
    }

    if (firstResponse) {
      extra = Object.fromEntries(
        Object.entries(response).filter(([key]) => key !== 'published' && key !== 'failures'),
      );
    }

    published.push(...response.published);
    failures.push(...response.failures);
    firstResponse = false;
  }

  return {
    ...(extra as Omit<MultiplePublishResult, 'published' | 'failures'>),
    accepted: typeof extra.accepted === 'boolean' ? extra.accepted : true,
    action: typeof extra.action === 'string' ? extra.action : ACTION_PUBLISH_MULTIPLE_RESOURCES,
    published,
    failures,
  };
}

/**
 * Deterministic staged filename for a NodeFM JSON metadata resource.
 *
 * Home requires a filename for staged bytes. NodeFM metadata resources are
 * plain JSON documents whose identity is the QDN coordinate, not the file
 * name, so the identifier is the stable source of the staged name.
 */
export function qdnJsonPublishFileName(identifier: string): string {
  const base = identifier
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '');

  return `${base || 'nodefm-metadata'}.json`;
}

// ── Select Publish Source (Native File Picker) ──────────────────────

export type SelectPublishSourceResult =
  | { canceled: true }
  | {
      canceled: false;
      fileName: string;
      kind: 'file' | 'directory';
      mimeType?: string;
      size: number;
      sourceToken: string;
    };

/**
 * Open the native file picker to select a file or directory for publishing.
 * Returns a sourceToken that can be passed to `publishResource()`.
 *
 * This is the safe path for large audio files — Home keeps the bytes on disk
 * and NodeFM never materializes them as base64 in the browser.
 */
export async function selectPublishSource(
  kind: 'file' | 'directory' = 'file',
): Promise<SelectPublishSourceResult> {
  await requireQdnPublishSourceSupported('select');

  return sendBridgeRequest({
    action: ACTION_SELECT_PUBLISH_SOURCE,
    kind,
  }) as Promise<SelectPublishSourceResult>;
}

// ── Search ──────────────────────────────────────────────────────────

export type QdnSearchParams = {
  service?: string;
  name?: string;
  query?: string;
  mode?: 'ALL' | 'LATEST';
  limit?: number;
  includeMetadata?: boolean;
  includeStatus?: boolean;
  prefix?: boolean;
  exactMatchNames?: boolean;
};

export type QdnResourceInfo = {
  name: string;
  service: string;
  identifier?: string;
  size?: number;
  created?: number;
  updated?: number;
  metadata?: {
    title?: string;
    description?: string;
    category?: string;
    tags?: string[];
    mimeType?: string;
  };
  status?: {
    status: string;
    percentLoaded?: number;
    localChunkCount?: number;
    totalChunkCount?: number;
  };
};

/**
 * Search QDN resources. Compatible with the Qortium Home bridge
 * SEARCH_QDN_RESOURCES action.
 */
export async function searchQdnResources(params: QdnSearchParams): Promise<QdnResourceInfo[]> {
  const payload: Record<string, unknown> = {
    action: 'SEARCH_QDN_RESOURCES',
    mode: params.mode ?? 'ALL',
    limit: params.limit ?? 50,
  };

  if (params.service) payload.service = params.service;
  if (params.name) payload.name = params.name;
  if (params.query) payload.query = params.query;
  if (params.includeMetadata) payload.includeMetadata = true;
  if (params.includeStatus) payload.includeStatus = true;
  if (params.prefix) payload.prefix = true;
  if (params.exactMatchNames) payload.exactMatchNames = true;

  return sendBridgeRequest(payload) as Promise<QdnResourceInfo[]>;
}

// ── List ────────────────────────────────────────────────────────────

/**
 * List QDN resources. Compatible with the Qortium Home bridge
 * LIST_QDN_RESOURCES action.
 */
export async function listQdnResources(params: QdnSearchParams): Promise<QdnResourceInfo[]> {
  const payload: Record<string, unknown> = {
    action: 'LIST_QDN_RESOURCES',
    limit: params.limit ?? 50,
  };

  if (params.service) payload.service = params.service;
  if (params.name) payload.name = params.name;
  if (params.includeMetadata) payload.includeMetadata = true;
  if (params.includeStatus) payload.includeStatus = true;

  return sendBridgeRequest(payload) as Promise<QdnResourceInfo[]>;
}

// ── Resource Metadata ───────────────────────────────────────────────

export type QdnResourceMetadata = {
  title?: string;
  description?: string;
  category?: string;
  tags?: string[];
  mimeType?: string;
  size?: number;
  created?: number;
  updated?: number;
};

export async function getQdnResourceMetadata(ref: QdnResourceRef): Promise<QdnResourceMetadata> {
  return sendBridgeRequest({
    action: 'GET_QDN_RESOURCE_METADATA',
    service: ref.service,
    name: ref.name,
    ...(ref.identifier ? { identifier: ref.identifier } : {}),
  }) as Promise<QdnResourceMetadata>;
}

// ── Resource Status ─────────────────────────────────────────────────

export type QdnResourceStatus = {
  status: string;
  percentLoaded?: number;
  localChunkCount?: number;
  totalChunkCount?: number;
};

export async function getQdnResourceStatus(
  ref: QdnResourceRef,
  build = false,
): Promise<QdnResourceStatus> {
  return sendBridgeRequest({
    action: 'GET_QDN_RESOURCE_STATUS',
    service: ref.service,
    name: ref.name,
    ...(build ? { build: true } : {}),
    ...(ref.identifier ? { identifier: ref.identifier } : {}),
  }) as Promise<QdnResourceStatus>;
}

const QDN_READY_STATUS = 'READY';
const QDN_BUILDABLE_STATUSES = new Set(['PUBLISHED', 'DOWNLOADING', 'DOWNLOADED', 'BUILDING']);
const QDN_MISSING_STATUSES = new Set([
  'MISSING',
  'NOT_FOUND',
  'NOT PUBLISHED',
  'NOT_PUBLISHED',
  'DOES_NOT_EXIST',
]);

function normalizeQdnStatus(value: unknown): string {
  if (typeof value === 'string') {
    return value.toUpperCase();
  }

  if (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { status?: unknown }).status === 'string'
  ) {
    return (value as { status: string }).status.toUpperCase();
  }

  return '';
}

/**
 * Wait for a QDN resource to become READY.
 *
 * Mirrors the proven readiness-polling pattern from the current
 * discussion-boards-reference (`ensureQdnResourceReady`) and
 * qortium-boards (`waitForQdnResourceReady`): check status, trigger a build
 * once for buildable states, then poll until READY or an explicit terminal
 * state. Never turns uncertainty into a valid ready state.
 */
export async function ensureQdnResourceReady(
  ref: QdnResourceRef,
  options: { retries?: number; delayMs?: number } = {},
): Promise<void> {
  const retries = options.retries ?? 8;
  const delayMs = options.delayMs ?? 1200;

  let status = '';

  try {
    status = normalizeQdnStatus(await getQdnResourceStatus(ref));
  } catch (error) {
    if (isConfirmedQdnNotFoundError(error)) {
      throw new QdnResourceReadError(
        'NOT_FOUND',
        `QDN resource does not exist: ${ref.service}/${ref.name}/${ref.identifier ?? 'default'}`,
        error,
      );
    }

    status = '';
  }

  if (status === QDN_READY_STATUS) {
    return;
  }

  if (QDN_MISSING_STATUSES.has(status)) {
    throw new QdnResourceReadError(
      'NOT_FOUND',
      `QDN resource does not exist: ${ref.service}/${ref.name}/${ref.identifier ?? 'default'}`,
    );
  }

  if (QDN_BUILDABLE_STATUSES.has(status)) {
    try {
      await getQdnResourceStatus(ref, true);
    } catch {
      // Build requests can race; polling below resolves the eventual state.
    }
  }

  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      status = normalizeQdnStatus(await getQdnResourceStatus(ref));
    } catch (error) {
      if (isConfirmedQdnNotFoundError(error)) {
        throw new QdnResourceReadError(
          'NOT_FOUND',
          `QDN resource does not exist: ${ref.service}/${ref.name}/${ref.identifier ?? 'default'}`,
          error,
        );
      }

      status = '';
    }

    if (status === QDN_READY_STATUS) {
      return;
    }

    if (QDN_MISSING_STATUSES.has(status)) {
      throw new QdnResourceReadError(
        'NOT_FOUND',
        `QDN resource does not exist: ${ref.service}/${ref.name}/${ref.identifier ?? 'default'}`,
      );
    }

    if (attempt < retries - 1) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, delayMs);
      });
    }
  }

  throw new Error(
    `QDN resource is not ready: ${ref.service}/${ref.name}/${ref.identifier ?? 'default'}`,
  );
}

// ── Resource URL ────────────────────────────────────────────────────

/**
 * Validate the current Qortium Home GET_QDN_RESOURCE_URL contract.
 *
 * Current Home returns the render URL as a raw string, not an
 * `{ url: string }` envelope.
 */
export function requireQdnResourceUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('GET_QDN_RESOURCE_URL did not return a resource URL string.');
  }

  return value;
}

/**
 * Get the ordinary render URL for a QDN resource.
 * Media playback should use getQdnResourceStreamUrl() instead so Home can
 * provide the platform-appropriate ranged stream transport.
 */
export async function getQdnResourceUrl(ref: QdnResourceRef): Promise<string> {
  const result = await sendBridgeRequest({
    action: 'GET_QDN_RESOURCE_URL',
    service: ref.service,
    name: ref.name,
    ...(ref.identifier ? { identifier: ref.identifier } : {}),
  });

  return requireQdnResourceUrl(result);
}

/** Validate the current Qortium Home media stream URL contract. */
export function requireQdnResourceStreamUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('GET_QDN_RESOURCE_STREAM_URL did not return a resource URL string.');
  }

  return value;
}

/**
 * Get an opaque, ranged media URL for a QDN resource.
 *
 * Home returns the appropriate transport for its host platform: desktop can
 * use its normal media route while Android uses Home's authorized HTTPS QDN
 * proxy. Callers must treat the returned URL as opaque.
 */
export async function getQdnResourceStreamUrl(ref: QdnResourceRef): Promise<string> {
  const result = await sendBridgeRequest({
    action: 'GET_QDN_RESOURCE_STREAM_URL',
    service: ref.service,
    name: ref.name,
    ...(ref.identifier ? { identifier: ref.identifier } : {}),
  });

  return requireQdnResourceStreamUrl(result);
}

export type QdnBackgroundAudioItem = {
  artist?: string;
  durationMs: number;
  endPositionMs: number;
  expectedStartUtcMs: number;
  mediaId: string;
  resource: QdnResourceRef;
  title: string;
};

export type QdnBackgroundAudioStatus = {
  currentIndex: number;
  currentPositionMs: number;
  hasQueue: boolean;
  isPlaying: boolean;
  mediaId: string | null;
  playbackState: 'idle' | 'buffering' | 'ready' | 'ended';
  playWhenReady: boolean;
};

export async function supportsQdnBackgroundAudio(): Promise<boolean> {
  const actions = await sendBridgeRequest<unknown>({ action: 'SHOW_ACTIONS' });
  return Array.isArray(actions) && actions.includes('SET_QDN_BACKGROUND_AUDIO_QUEUE');
}

export async function setQdnBackgroundAudioQueue(
  items: readonly QdnBackgroundAudioItem[],
  startPositionMs: number,
): Promise<QdnBackgroundAudioStatus> {
  return sendBridgeRequest({
    action: 'SET_QDN_BACKGROUND_AUDIO_QUEUE',
    items: items.map((item) => ({
      artist: item.artist,
      durationMs: item.durationMs,
      endPositionMs: item.endPositionMs,
      expectedStartUtcMs: item.expectedStartUtcMs,
      mediaId: item.mediaId,
      service: item.resource.service,
      name: item.resource.name,
      ...(item.resource.identifier ? { identifier: item.resource.identifier } : {}),
      title: item.title,
    })),
    playWhenReady: true,
    startIndex: 0,
    startPositionMs: Math.max(0, Math.round(startPositionMs)),
  });
}

export async function controlQdnBackgroundAudio(
  command: 'pause' | 'play' | 'stop',
): Promise<QdnBackgroundAudioStatus> {
  return sendBridgeRequest({ action: 'CONTROL_QDN_BACKGROUND_AUDIO', command });
}

export async function getQdnBackgroundAudioStatus(): Promise<QdnBackgroundAudioStatus> {
  return sendBridgeRequest({ action: 'GET_QDN_BACKGROUND_AUDIO_STATUS' });
}

// ── Delete Resource ─────────────────────────────────────────────────

export async function deleteQdnResource(ref: QdnResourceRef): Promise<unknown> {
  await requireAccountWrite('DELETE_QDN_RESOURCE');

  return sendBridgeRequest({
    action: 'DELETE_QDN_RESOURCE',
    service: ref.service,
    name: ref.name,
    ...(ref.identifier ? { identifier: ref.identifier } : {}),
  });
}

// ── Fetch Resource ──────────────────────────────────────────────────

/**
 * Canonical decoder for the current Qortium Home FETCH_QDN_RESOURCE
 * contract.
 *
 * Home's `fetchNodeApiPayload` returns the node response `data` directly:
 * - already parsed JSON (objects, arrays, or JSON primitives);
 * - raw string content for non-JSON bodies or when JSON parsing fails;
 * - `null` for an empty body.
 *
 * This decoder normalizes those cases without inventing `{ body }` or
 * `{ data }` envelopes. Malformed JSON-looking strings fail explicitly
 * rather than being passed through as valid content.
 */
export function decodeQdnResourcePayload(value: unknown): unknown {
  if (value === null || value === undefined) {
    throw new Error('QDN resource payload is empty.');
  }

  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error('QDN resource payload is empty.');
  }

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch (error) {
      throw new Error(
        `QDN resource payload is malformed JSON: ${
          error instanceof Error ? error.message : 'parse failed'
        }`,
      );
    }
  }

  return value;
}

/**
 * Fetch a QDN resource and decode it with the current production
 * contract. Use this for bounded whole-resource reads such as JSON
 * metadata records.
 */
export async function fetchQdnResourceData(ref: QdnResourceRef): Promise<unknown> {
  let result: unknown;

  try {
    result = await sendBridgeRequest({
      action: 'FETCH_QDN_RESOURCE',
      service: ref.service,
      name: ref.name,
      ...(ref.identifier ? { identifier: ref.identifier } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'QDN resource fetch failed.';

    throw new QdnResourceReadError(
      isConfirmedQdnNotFoundError(error) ? 'NOT_FOUND' : 'UNAVAILABLE',
      message,
      error,
    );
  }

  try {
    return decodeQdnResourcePayload(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'QDN resource payload is malformed.';

    throw new QdnResourceReadError('MALFORMED', message, error);
  }
}
