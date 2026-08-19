/* ============================================================
 * NodeFM Station — Request Show Store
 *
 * Account-scoped QDN persistence for Request Show definitions
 * and immutable generated occurrences. Occurrences are canonical
 * once published; materialization reuses an existing occurrence
 * rather than regenerating a different lineup for the same event.
 * ============================================================ */

import type {
  DynamicProgramDefinition,
  DynamicProgramOccurrence,
  ScheduleEvent,
  Track,
} from '../../../types/domain';
import { fetchQdnResourceData, publishResource, searchQdnResources } from '../../../qortium/qdn';
import type { RankedLikedTrack } from '../../likes/services/likeService';
import {
  DYNAMIC_PROGRAM_IDENTIFIER_PREFIX,
  REQUEST_SHOW_OCCURRENCE_IDENTIFIER_PREFIX,
  REQUEST_SHOW_QDN_SERVICE,
  createDynamicProgramDefinition,
  deserializeDynamicProgramDefinitionFromQdn,
  deserializeDynamicProgramOccurrenceFromQdn,
  generateRequestShowOccurrence,
  getDynamicProgramQdnIdentifier,
  getRequestShowOccurrenceQdnIdentifier,
  isValidDynamicProgramDefinition,
  isValidDynamicProgramOccurrence,
  serializeDynamicProgramDefinitionForQdn,
  serializeDynamicProgramOccurrenceForQdn,
  type CreateDynamicProgramDefinitionInput,
} from './requestShowService';

type RequestShowListener = () => void;

let requestShowDefinitions: DynamicProgramDefinition[] = [];
let requestShowOccurrences: DynamicProgramOccurrence[] = [];
let requestShowLoaded = false;
let requestShowLoading = false;
let requestShowError: string | null = null;
let requestShowActiveScope: string | null = null;
let requestShowEpoch = 0;

const listeners = new Set<RequestShowListener>();

function notify() {
  listeners.forEach((listener) => listener());
}

function scopeKey(ownerName: string, ownerAddress: string): string {
  return `${ownerAddress}\u0000${ownerName}`;
}

async function persistDefinition(
  definition: DynamicProgramDefinition,
  ownerName: string,
): Promise<void> {
  if (!isValidDynamicProgramDefinition(definition)) {
    throw new Error('Request Show definition is invalid.');
  }

  const data64 = btoa(
    unescape(encodeURIComponent(serializeDynamicProgramDefinitionForQdn(definition))),
  );

  await publishResource({
    service: REQUEST_SHOW_QDN_SERVICE,
    name: ownerName,
    identifier: getDynamicProgramQdnIdentifier(definition.programDefinitionId),
    data64,
    title: definition.title,
  });
}

export async function persistRequestShowOccurrence(
  occurrence: DynamicProgramOccurrence,
  ownerName: string,
): Promise<void> {
  if (!isValidDynamicProgramOccurrence(occurrence)) {
    throw new Error('Request Show occurrence is invalid.');
  }

  const data64 = btoa(
    unescape(encodeURIComponent(serializeDynamicProgramOccurrenceForQdn(occurrence))),
  );

  await publishResource({
    service: REQUEST_SHOW_QDN_SERVICE,
    name: ownerName,
    identifier: getRequestShowOccurrenceQdnIdentifier(occurrence.scheduleEventId),
    data64,
    title: `Request Show ${occurrence.scheduleEventId}`,
  });
}

export function subscribeToRequestShowStore(listener: RequestShowListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getRequestShowDefinitions(): DynamicProgramDefinition[] {
  return [...requestShowDefinitions];
}

export function getRequestShowOccurrences(): DynamicProgramOccurrence[] {
  return [...requestShowOccurrences];
}

export function getRequestShowDefinitionById(
  programDefinitionId: string,
): DynamicProgramDefinition | undefined {
  return requestShowDefinitions.find(
    (definition) => definition.programDefinitionId === programDefinitionId,
  );
}

export function getRequestShowOccurrenceByScheduleEventId(
  scheduleEventId: string,
): DynamicProgramOccurrence | undefined {
  return requestShowOccurrences.find(
    (occurrence) => occurrence.scheduleEventId === scheduleEventId,
  );
}

export function getRequestShowLoaded(): boolean {
  return requestShowLoaded;
}

export function getRequestShowLoading(): boolean {
  return requestShowLoading;
}

export function getRequestShowError(): string | null {
  return requestShowError;
}

export function getRequestShowActiveScope(): string | null {
  return requestShowActiveScope;
}

export function isRequestShowCurrentScope(ownerName: string, ownerAddress: string): boolean {
  return requestShowActiveScope === scopeKey(ownerName, ownerAddress);
}

export type RequestShowLoadAction = 'clear' | 'reuse' | 'load';

export function getRequestShowLoadAction(
  ownerName: string | null,
  ownerAddress: string | null,
): RequestShowLoadAction {
  if (!ownerName || !ownerAddress) {
    return 'clear';
  }

  if (
    isRequestShowCurrentScope(ownerName, ownerAddress) &&
    (requestShowLoaded || requestShowLoading)
  ) {
    return 'reuse';
  }

  return 'load';
}

async function discoverRequestShowIdentifiers(ownerName: string): Promise<string[]> {
  const results = await searchQdnResources({
    service: REQUEST_SHOW_QDN_SERVICE,
    name: ownerName,
    query: DYNAMIC_PROGRAM_IDENTIFIER_PREFIX,
    prefix: true,
    mode: 'ALL',
    limit: 1000,
    includeMetadata: true,
  });

  const seen = new Set<string>();
  const identifiers: string[] = [];

  for (const result of results) {
    if (
      !result.identifier ||
      (!result.identifier.startsWith(DYNAMIC_PROGRAM_IDENTIFIER_PREFIX) &&
        !result.identifier.startsWith(REQUEST_SHOW_OCCURRENCE_IDENTIFIER_PREFIX))
    ) {
      continue;
    }

    if (seen.has(result.identifier)) {
      continue;
    }

    seen.add(result.identifier);
    identifiers.push(result.identifier);
  }

  return identifiers;
}

async function fetchRequestShowRecord(ownerName: string, identifier: string): Promise<unknown> {
  return fetchQdnResourceData({
    service: REQUEST_SHOW_QDN_SERVICE,
    name: ownerName,
    identifier,
  });
}

export async function loadRequestShowStore(ownerName: string, ownerAddress: string): Promise<void> {
  if (requestShowLoaded || requestShowLoading) {
    return;
  }

  const targetScope = scopeKey(ownerName, ownerAddress);
  const epoch = requestShowEpoch;

  requestShowActiveScope = targetScope;
  requestShowLoading = true;
  requestShowError = null;
  notify();

  try {
    const identifiers = await discoverRequestShowIdentifiers(ownerName);
    const definitions: DynamicProgramDefinition[] = [];
    const occurrences: DynamicProgramOccurrence[] = [];

    for (const identifier of identifiers) {
      const payload = await fetchRequestShowRecord(ownerName, identifier);

      if (identifier.startsWith(REQUEST_SHOW_OCCURRENCE_IDENTIFIER_PREFIX)) {
        const occurrence = deserializeDynamicProgramOccurrenceFromQdn(payload);
        if (!occurrence) {
          throw new Error(`Malformed Request Show occurrence resource: ${identifier}`);
        }

        occurrences.push(occurrence);
        continue;
      }

      const definition = deserializeDynamicProgramDefinitionFromQdn(payload);
      if (!definition) {
        throw new Error(`Malformed Request Show definition resource: ${identifier}`);
      }

      definitions.push(definition);
    }

    if (epoch !== requestShowEpoch || requestShowActiveScope !== targetScope) {
      return;
    }

    requestShowDefinitions = definitions;
    requestShowOccurrences = occurrences;
    requestShowLoaded = true;
  } catch (error) {
    if (epoch !== requestShowEpoch || requestShowActiveScope !== targetScope) {
      return;
    }

    requestShowError = error instanceof Error ? error.message : 'Failed to load Request Show data.';
  } finally {
    if (epoch === requestShowEpoch) {
      requestShowLoading = false;
      notify();
    }
  }
}

export async function loadRequestShowOccurrencesForPublisher(
  publisherName: string,
): Promise<DynamicProgramOccurrence[]> {
  const results = await searchQdnResources({
    service: REQUEST_SHOW_QDN_SERVICE,
    name: publisherName,
    query: REQUEST_SHOW_OCCURRENCE_IDENTIFIER_PREFIX,
    prefix: true,
    mode: 'ALL',
    limit: 1000,
    includeMetadata: true,
  });

  const seen = new Set<string>();
  const occurrences: DynamicProgramOccurrence[] = [];

  for (const result of results) {
    if (
      !result.identifier ||
      !result.identifier.startsWith(REQUEST_SHOW_OCCURRENCE_IDENTIFIER_PREFIX)
    ) {
      continue;
    }

    if (seen.has(result.identifier)) {
      continue;
    }

    seen.add(result.identifier);
    const payload = await fetchQdnResourceData({
      service: REQUEST_SHOW_QDN_SERVICE,
      name: publisherName,
      identifier: result.identifier,
    });
    const occurrence = deserializeDynamicProgramOccurrenceFromQdn(payload);

    if (!occurrence) {
      throw new Error(`Malformed Request Show occurrence resource: ${result.identifier}`);
    }

    occurrences.push(occurrence);
  }

  return occurrences;
}

export async function createRequestShowDefinitionAction(
  input: CreateDynamicProgramDefinitionInput,
  ownerName: string,
): Promise<DynamicProgramDefinition> {
  const definition = createDynamicProgramDefinition(input);

  try {
    await persistDefinition(definition, ownerName);
  } catch (error) {
    throw new Error(
      `Failed to publish Request Show definition: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
    );
  }

  requestShowDefinitions = [...requestShowDefinitions, definition];
  notify();
  return definition;
}

export async function updateRequestShowDefinitionAction(
  programDefinitionId: string,
  input: CreateDynamicProgramDefinitionInput,
  ownerName: string,
): Promise<DynamicProgramDefinition> {
  const index = requestShowDefinitions.findIndex(
    (definition) => definition.programDefinitionId === programDefinitionId,
  );
  if (index === -1) {
    throw new Error(`Request Show definition not found: ${programDefinitionId}`);
  }

  if (!input.title.trim()) {
    throw new Error('Request Show title must be a non-empty string.');
  }

  if (!Number.isInteger(input.targetDurationMs) || input.targetDurationMs <= 0) {
    throw new Error('Request Show target duration must be a positive integer in milliseconds.');
  }

  const updated: DynamicProgramDefinition = {
    ...requestShowDefinitions[index],
    title: input.title.trim(),
    targetDurationMs: input.targetDurationMs,
    updatedAt: new Date().toISOString(),
  };

  try {
    await persistDefinition(updated, ownerName);
  } catch (error) {
    throw new Error(
      `Failed to update Request Show definition: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
    );
  }

  requestShowDefinitions = [
    ...requestShowDefinitions.slice(0, index),
    updated,
    ...requestShowDefinitions.slice(index + 1),
  ];
  notify();
  return updated;
}

export async function publishRequestShowOccurrenceAction(
  occurrence: DynamicProgramOccurrence,
  ownerName: string,
): Promise<DynamicProgramOccurrence> {
  try {
    await persistRequestShowOccurrence(occurrence, ownerName);
  } catch (error) {
    throw new Error(
      `Failed to publish Request Show occurrence: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
    );
  }

  const existingIndex = requestShowOccurrences.findIndex(
    (candidate) => candidate.scheduleEventId === occurrence.scheduleEventId,
  );

  requestShowOccurrences =
    existingIndex === -1
      ? [...requestShowOccurrences, occurrence]
      : [
          ...requestShowOccurrences.slice(0, existingIndex),
          occurrence,
          ...requestShowOccurrences.slice(existingIndex + 1),
        ];
  notify();
  return occurrence;
}

export async function materializeRequestShowOccurrenceAction(
  scheduleEvent: ScheduleEvent,
  definition: DynamicProgramDefinition,
  eligibleTracks: readonly Track[],
  rankedLikedTracks: readonly RankedLikedTrack[],
  generatedAt: string,
  ownerName: string,
  options: { reuseExisting?: boolean } = {},
): Promise<DynamicProgramOccurrence> {
  const existing = getRequestShowOccurrenceByScheduleEventId(scheduleEvent.eventId);
  if (existing && options.reuseExisting !== false) {
    return existing;
  }

  const generation = generateRequestShowOccurrence(
    scheduleEvent,
    definition,
    eligibleTracks,
    rankedLikedTracks,
    generatedAt,
  );

  if (!generation.ok) {
    throw new Error(generation.message);
  }

  return publishRequestShowOccurrenceAction(generation.occurrence, ownerName);
}

export function resetRequestShowStore(): void {
  requestShowDefinitions = [];
  requestShowOccurrences = [];
  requestShowLoaded = false;
  requestShowLoading = false;
  requestShowError = null;
  requestShowActiveScope = null;
  requestShowEpoch += 1;
  notify();
}
