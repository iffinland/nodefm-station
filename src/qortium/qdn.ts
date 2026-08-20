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

// ── Publish ─────────────────────────────────────────────────────────

export type PublishInput = {
  /** QDN service name (e.g. 'AUDIO', 'IMAGE', 'JSON', 'PLAYLIST') */
  service: string;
  /** Publishing name (unique per service + identifier) */
  name: string;
  /** Optional identifier (use 'default' for standard) */
  identifier?: string;
  /** Base64-encoded resource data (for small resources) */
  data64?: string;
  /** Source token from SELECT_QDN_PUBLISH_SOURCE (for large files) */
  sourceToken?: string;
  /** Human-readable title */
  title?: string;
  /** Description */
  description?: string;
  /** Category */
  category?: string;
  /** Tags */
  tags?: string[];
  /** Original filename */
  filename?: string;
  /** Fee (0 for public nodes) */
  fee?: number;
};

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

export type PublishMultipleResource = {
  /** QDN service name (e.g. 'JSON', 'IMAGE') */
  service: string;
  /** Publishing name (unique per service + identifier) */
  name: string;
  /** Optional identifier (use 'default' for standard) */
  identifier?: string;
  /** Base64-encoded resource data for inline resources */
  data64?: string;
  /** Source token from SELECT_QDN_PUBLISH_SOURCE for large files */
  sourceToken?: string;
  title?: string;
  description?: string;
  category?: string;
  tags?: string[];
  filename?: string;
  fee?: number;
};

export type MultiplePublishPublishedResource = {
  result: unknown;
  resource: {
    identifier: string | null;
    name: string;
    service: string;
  };
  transactionSignature: string;
};

export type MultiplePublishFailedResource = {
  error: string;
  resource: {
    identifier: string | null;
    name: string;
    service: string;
  };
};

export type MultiplePublishResult = {
  accepted: boolean;
  action: string;
  published: MultiplePublishPublishedResource[];
  failures: MultiplePublishFailedResource[];
};

/**
 * Publish a QDN resource.
 *
 * Small resources (metadata JSON) use `data64`.
 * Large files (audio) should use `sourceToken` from `selectPublishSource()`.
 */
export async function publishResource(input: PublishInput): Promise<PublishResult> {
  const payload: Record<string, unknown> = {
    action: 'PUBLISH_QDN_RESOURCE' as const,
    service: input.service,
    name: input.name,
  };

  if (input.identifier) payload.identifier = input.identifier;
  if (input.data64) payload.data64 = input.data64;
  if (input.sourceToken) payload.sourceToken = input.sourceToken;
  if (input.title) payload.title = input.title;
  if (input.description) payload.description = input.description;
  if (input.category) payload.category = input.category;
  if (input.tags?.length) payload.tags = input.tags;
  if (input.filename) payload.filename = input.filename;
  if (typeof input.fee === 'number') payload.fee = input.fee;

  return sendBridgeRequest(payload) as Promise<PublishResult>;
}

/**
 * Publish several QDN resources through one Home approval request.
 *
 * This uses the current `PUBLISH_MULTIPLE_QDN_RESOURCES` bridge action.
 * Home processes resources sequentially; each is still its own QDN
 * transaction. The result therefore has explicit `published` and
 * `failures` arrays and must not be treated as atomic.
 */
export async function publishMultipleResources(
  resources: readonly PublishMultipleResource[],
): Promise<MultiplePublishResult> {
  if (resources.length === 0) {
    throw new Error('At least one resource is required for QDN batch publication.');
  }

  const payloadResources = resources.map((resource) => {
    const payload: Record<string, unknown> = {
      service: resource.service,
      name: resource.name,
    };

    if (resource.identifier) payload.identifier = resource.identifier;
    if (resource.data64) payload.data64 = resource.data64;
    if (resource.sourceToken) payload.sourceToken = resource.sourceToken;
    if (resource.title) payload.title = resource.title;
    if (resource.description) payload.description = resource.description;
    if (resource.category) payload.category = resource.category;
    if (resource.tags?.length) payload.tags = resource.tags;
    if (resource.filename) payload.filename = resource.filename;
    if (typeof resource.fee === 'number') payload.fee = resource.fee;

    return payload;
  });

  return sendBridgeRequest({
    action: 'PUBLISH_MULTIPLE_QDN_RESOURCES',
    resources: payloadResources,
  }) as Promise<MultiplePublishResult>;
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
 * This is the safe path for large audio files — avoids base64 in the browser.
 */
export async function selectPublishSource(
  kind: 'file' | 'directory' = 'file',
): Promise<SelectPublishSourceResult> {
  return sendBridgeRequest({
    action: 'SELECT_QDN_PUBLISH_SOURCE',
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
  } catch {
    status = '';
  }

  if (status === QDN_READY_STATUS) {
    return;
  }

  if (QDN_MISSING_STATUSES.has(status)) {
    throw new Error(
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
    } catch {
      status = '';
    }

    if (status === QDN_READY_STATUS) {
      return;
    }

    if (QDN_MISSING_STATUSES.has(status)) {
      throw new Error(
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
 * Get a playable URL for a QDN resource.
 * Essential for the audio engine to play QDN-hosted tracks.
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

// ── Delete Resource ─────────────────────────────────────────────────

export async function deleteQdnResource(ref: QdnResourceRef): Promise<unknown> {
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
  const result = await sendBridgeRequest({
    action: 'FETCH_QDN_RESOURCE',
    service: ref.service,
    name: ref.name,
    ...(ref.identifier ? { identifier: ref.identifier } : {}),
  });

  return decodeQdnResourcePayload(result);
}
