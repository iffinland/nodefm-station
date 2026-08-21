import { describe, expect, it } from 'vitest';
import {
  computeAudioContentRevision,
  computeCoverContentRevision,
  computeMetadataContentRevision,
} from './contentRevision';
import { createBulkImportBatch, createBulkImportRow } from './batchStore';
import { deserializeBulkImportBatch, serializeBulkImportBatch } from './services/bulkImportStorage';
import type {
  BulkPublicationAcquisitionResult,
  BulkPublicationAdapter,
  BulkPublicationBatchResult,
  BulkPublicationIntent,
  BulkPublicationRowIntent,
  BulkPublicationSourceDescriptor,
  BulkPublicationStepKind,
  BulkPublicationStepResult,
  BulkPublicationCoverIntent,
} from './publicationAdapter';
import {
  isBulkPublicationRowResultCurrent,
  isBulkPublicationStepResultCurrent,
  mapBulkImportRoleToPublicationIntent,
  validateBulkPublicationStepResultAgainstCurrentRow,
} from './publicationAdapter';
import {
  createEmptyPublicationJournal,
  createPublishedPublicationStep,
  createUnknownPublicationStep,
  getUnknownPublicationSteps,
  publicationStepMatchesContent,
} from './publicationJournal';
import type {
  BulkImportPublicationReference,
  BulkImportPublicationJournal,
  BulkImportPublicationPublishedStep,
  BulkImportPublicationResourceIdentity,
  BulkImportBatch,
  BulkImportRole,
  BulkImportRow,
} from './types';

type StepKind = Exclude<BulkPublicationStepKind, 'source'>;
type Outcome = 'published' | 'failed' | 'unknown' | 'skipped' | 'auto';

type FakeHandle = {
  key: string;
  batchId: string;
  rowId: string;
  sourceGeneration: number;
  handleId: string;
  descriptor: BulkPublicationSourceDescriptor;
  consumed: boolean;
};

type FakeUnknownAttempt = {
  key: string;
  batchId: string;
  rowId: string;
  sourceGeneration: number;
  step: StepKind;
  intent: BulkImportPublicationResourceIdentity;
  contentRevision: string;
  reference: BulkImportPublicationReference | null;
  attemptId: string;
  resolved: boolean;
};

type FakePlatformBackend = {
  unknownAttempts: Map<string, FakeUnknownAttempt>;
};

type FakeAdapterMemory = {
  handles: Map<string, FakeHandle>;
  nextHandle: number;
};

type FakeOptions = {
  publishOutcome?: (row: BulkPublicationRowIntent, step: StepKind) => Outcome;
  reconcileOutcome?: (
    row: BulkPublicationRowIntent,
    step: StepKind,
    attempt: FakeUnknownAttempt,
  ) => 'published' | 'failed' | 'unknown';
};

function makeRowIntent(
  rowId: string,
  overrides: Partial<BulkPublicationRowIntent> = {},
): BulkPublicationRowIntent {
  return {
    rowId,
    sourceGeneration: 0,
    roleIntent: 'track',
    source: { fileName: `${rowId}.mp3`, mimeType: 'audio/mpeg', sizeBytes: 100 },
    metadata: {
      artist: 'Artist',
      title: `Title ${rowId}`,
      album: '',
      releaseDate: '',
      genres: [],
      tags: [],
    },
    durationMs: 120000,
    cover: null,
    publication: createEmptyPublicationJournal(),
    ...overrides,
  };
}

function makeIntent(role: BulkImportRole, rows: BulkPublicationRowIntent[]): BulkPublicationIntent {
  return {
    batchId: 'batch-1',
    role,
    scope: role === 'admin' ? 'owner-scope' : 'listener-scope',
    actor: {
      name: role === 'admin' ? 'Owner' : 'Listener',
      address: role === 'admin' ? 'Q-owner' : 'Q-listener',
    },
    rows,
  };
}

function rowKey(batchId: string, rowId: string, sourceGeneration: number): string {
  return `${batchId}:${rowId}:${sourceGeneration}`;
}

function unknownKey(
  batchId: string,
  rowId: string,
  sourceGeneration: number,
  step: StepKind,
  attemptId: string,
): string {
  return `${batchId}:${rowId}:${sourceGeneration}:${step}:${attemptId}`;
}

function stepIntent(
  intent: BulkPublicationIntent,
  row: BulkPublicationRowIntent,
  step: StepKind,
): BulkImportPublicationResourceIdentity {
  return {
    kind: step,
    service: step === 'audio' ? 'AUDIO' : step === 'cover' ? 'IMAGE' : 'JSON',
    name: intent.actor.name ?? 'Publisher',
    identifier: `${row.rowId}-${step}`,
  };
}

function intendedRevision(row: BulkPublicationRowIntent, step: StepKind): string | null {
  if (step === 'audio') return computeAudioContentRevision(row.source, row.sourceGeneration);
  if (step === 'cover') {
    return row.cover ? computeCoverContentRevision(coverToDraft(row.cover)) : null;
  }
  return computeMetadataContentRevision(row.metadata);
}

function requiredIntendedRevision(row: BulkPublicationRowIntent, step: StepKind): string {
  const revision = intendedRevision(row, step);
  if (!revision) {
    throw new Error(`Cannot produce a resource outcome for ${step} without a content revision.`);
  }
  return revision;
}

function coverToDraft(cover: BulkPublicationCoverIntent) {
  return {
    origin: cover.origin,
    fileName: cover.fileName,
    mimeType: cover.mimeType,
    sizeBytes: cover.sizeBytes,
    previewUrl: null,
  };
}

function bulkRowFromPublicationIntent(row: BulkPublicationRowIntent): BulkImportRow {
  const created = createBulkImportRow({
    id: row.rowId,
    fileName: row.source?.fileName ?? `${row.rowId}.mp3`,
    mimeType: row.source?.mimeType ?? 'audio/mpeg',
    sizeBytes: row.source?.sizeBytes ?? 100,
  });

  return {
    ...created,
    sourceGeneration: row.sourceGeneration,
    metadata: { ...row.metadata },
    durationMs: row.durationMs,
    durationSource: row.durationMs === null ? 'none' : 'embedded',
    cover: row.cover
      ? {
          origin: row.cover.origin,
          fileName: row.cover.fileName,
          mimeType: row.cover.mimeType,
          sizeBytes: row.cover.sizeBytes,
          previewUrl: null,
        }
      : null,
    coverSourceAvailable: row.cover !== null,
    publication: row.publication,
    extraction: { status: 'complete' },
  } as BulkImportRow;
}

function batchFromPublicationIntent(intent: BulkPublicationIntent): BulkImportBatch {
  return {
    ...createBulkImportBatch(intent.role, intent.scope, { id: intent.batchId }),
    rows: intent.rows.map((row) => bulkRowFromPublicationIntent(row)),
  };
}

function publicationIntentFromBatch(
  batch: BulkImportBatch,
  role: BulkImportRole,
  scope: string,
): BulkPublicationIntent {
  const roleIntent = mapBulkImportRoleToPublicationIntent(role);

  return {
    batchId: batch.id,
    role,
    scope,
    actor: {
      name: role === 'admin' ? 'Owner' : 'Listener',
      address: role === 'admin' ? 'Q-owner' : 'Q-listener',
    },
    rows: batch.rows.map((row) => ({
      rowId: row.id,
      sourceGeneration: row.sourceGeneration,
      roleIntent,
      source: row.localSource,
      metadata: row.metadata,
      durationMs: row.durationMs,
      cover: row.cover
        ? {
            origin: row.cover.origin,
            fileName: row.cover.fileName,
            mimeType: row.cover.mimeType,
            sizeBytes: row.cover.sizeBytes,
          }
        : null,
      publication: row.publication,
    })),
  };
}

function referenceFor(
  intent: BulkPublicationIntent,
  row: BulkPublicationRowIntent,
  step: StepKind,
): BulkImportPublicationReference {
  return {
    service: step === 'audio' ? 'AUDIO' : step === 'cover' ? 'IMAGE' : 'JSON',
    name: intent.actor.name ?? 'Publisher',
    identifier: `${row.rowId}-${step}`,
  };
}

function stepOutcomeToStatus(
  steps: BulkPublicationStepResult[],
): 'complete' | 'partial' | 'failed' | 'unknown' | 'no-op' {
  if (steps.length === 0) return 'no-op';
  if (steps.some((step) => step.status === 'failed')) return 'failed';
  if (steps.some((step) => step.status === 'unknown')) return 'unknown';
  if (steps.every((step) => step.status === 'published' || step.status === 'skipped')) {
    return 'complete';
  }
  return 'partial';
}

function matchingPublishedStep(
  row: BulkPublicationRowIntent,
  step: StepKind,
): BulkImportPublicationPublishedStep | null {
  const journal = row.publication;
  const record = journal[step];
  const revision = intendedRevision(row, step);
  return publicationStepMatchesContent(record, step, revision) ? record : null;
}

function createFakePlatformBackend(): FakePlatformBackend {
  return {
    unknownAttempts: new Map(),
  };
}

function createStatefulFakeAdapter(options: FakeOptions = {}): {
  adapter: BulkPublicationAdapter;
  backend: FakePlatformBackend;
  memory: FakeAdapterMemory;
} {
  return createStatefulFakeAdapterWithBackend(createFakePlatformBackend(), options);
}

function createStatefulFakeAdapterWithBackend(
  backend: FakePlatformBackend,
  options: FakeOptions = {},
): {
  adapter: BulkPublicationAdapter;
  backend: FakePlatformBackend;
  memory: FakeAdapterMemory;
} {
  const memory: FakeAdapterMemory = {
    handles: new Map(),
    nextHandle: 1,
  };

  const adapter: BulkPublicationAdapter = {
    capability: () => ({ status: 'available', message: 'stateful fake adapter' }),

    acquirePublicationSources: async (intent) => {
      validateRoleIntent(intent);
      return acquireSources(intent, memory);
    },

    publishBatch: async (intent, sources) =>
      publishBatch(intent, sources, backend, memory, options),

    reconcileBatch: async (intent) => reconcileBatch(intent, backend, options),
  };

  return { adapter, backend, memory };
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

function acquireSources(
  intent: BulkPublicationIntent,
  memory: FakeAdapterMemory,
): BulkPublicationAcquisitionResult {
  const sources: BulkPublicationSourceDescriptor[] = [];
  const failedRows: BulkPublicationAcquisitionResult['failedRows'] = [];

  for (const row of intent.rows) {
    if (!row.source) {
      failedRows.push({
        batchId: intent.batchId,
        rowId: row.rowId,
        sourceGeneration: row.sourceGeneration,
        error: { code: 'SOURCE_UNAVAILABLE', message: 'reacquisition required', retryable: false },
      });
      continue;
    }

    const key = rowKey(intent.batchId, row.rowId, row.sourceGeneration);
    const existing = memory.handles.get(key);
    if (existing && !existing.consumed) {
      throw new Error(`Duplicate acquisition handle for row ${row.rowId}.`);
    }

    const handleId = existing
      ? `handle-${row.rowId}-${row.sourceGeneration}-${++memory.nextHandle}`
      : `handle-${row.rowId}-${row.sourceGeneration}`;
    const descriptor: BulkPublicationSourceDescriptor = {
      rowId: row.rowId,
      sourceGeneration: row.sourceGeneration,
      handleId,
      fileName: row.source.fileName,
      mimeType: row.source.mimeType,
      sizeBytes: row.source.sizeBytes,
      available: true,
    };

    memory.handles.set(key, {
      key,
      batchId: intent.batchId,
      rowId: row.rowId,
      sourceGeneration: row.sourceGeneration,
      handleId,
      descriptor,
      consumed: false,
    });
    sources.push(descriptor);
  }

  return { batchId: intent.batchId, sources, failedRows };
}

function validateSources(
  intent: BulkPublicationIntent,
  sources: readonly BulkPublicationSourceDescriptor[],
  memory: FakeAdapterMemory,
): void {
  const expectedRows = intent.rows.filter((row) => row.source);
  if (sources.length !== expectedRows.length) {
    throw new Error('Source set does not match the requested rows.');
  }

  const seen = new Set<string>();
  for (const source of sources) {
    const key = rowKey(intent.batchId, source.rowId, source.sourceGeneration);
    if (seen.has(key)) throw new Error(`Duplicate source for row ${source.rowId}.`);
    seen.add(key);

    const row = intent.rows.find((candidate) => candidate.rowId === source.rowId);
    if (!row || row.sourceGeneration !== source.sourceGeneration) {
      throw new Error(`Source is bound to an unknown or stale row ${source.rowId}.`);
    }

    const handle = memory.handles.get(key);
    if (!handle) throw new Error(`Missing acquisition handle for row ${source.rowId}.`);
    if (handle.batchId !== intent.batchId) throw new Error('Handle batch ID mismatch.');
    if (handle.consumed) throw new Error(`Handle for row ${source.rowId} was already consumed.`);
    if (handle.descriptor.handleId !== source.handleId) {
      throw new Error(`Stale handle supplied for row ${source.rowId}.`);
    }
    if (
      handle.descriptor.fileName !== source.fileName ||
      handle.descriptor.mimeType !== source.mimeType ||
      handle.descriptor.sizeBytes !== source.sizeBytes
    ) {
      throw new Error(`Handle descriptor mismatch for row ${source.rowId}.`);
    }
  }

  for (const row of expectedRows) {
    const key = rowKey(intent.batchId, row.rowId, row.sourceGeneration);
    if (!seen.has(key)) throw new Error(`Missing source for row ${row.rowId}.`);
  }
}

function publishBatch(
  intent: BulkPublicationIntent,
  sources: readonly BulkPublicationSourceDescriptor[],
  backend: FakePlatformBackend,
  memory: FakeAdapterMemory,
  options: FakeOptions,
): BulkPublicationBatchResult {
  validateRoleIntent(intent);
  validateSources(intent, sources, memory);

  for (const source of sources) {
    const key = rowKey(intent.batchId, source.rowId, source.sourceGeneration);
    const handle = memory.handles.get(key);
    if (handle) handle.consumed = true;
  }

  const rows = intent.rows.map((row) => {
    const steps = stepsForRow(intent, row, backend, options);
    return {
      batchId: intent.batchId,
      rowId: row.rowId,
      sourceGeneration: row.sourceGeneration,
      status: stepOutcomeToStatus(steps),
      steps,
    };
  });

  return {
    batchId: intent.batchId,
    rows,
    publishedCount: rows.filter((row) => row.status === 'complete').length,
    failedCount: rows.filter((row) => row.status === 'failed').length,
    unknownCount: rows.filter((row) => row.status === 'unknown').length,
  };
}

function stepsForRow(
  intent: BulkPublicationIntent,
  row: BulkPublicationRowIntent,
  backend: FakePlatformBackend,
  options: FakeOptions,
): BulkPublicationStepResult[] {
  const steps: BulkPublicationStepResult[] = [];
  steps.push(makeStepResult(intent, row, 'audio', backend, options));
  if (row.cover) {
    steps.push(makeStepResult(intent, row, 'cover', backend, options));
  } else {
    steps.push(
      skippedResult(intent, row, 'cover', {
        reason: 'not-required',
      }),
    );
  }
  steps.push(makeStepResult(intent, row, 'metadata', backend, options));
  return steps;
}

function makeStepResult(
  intent: BulkPublicationIntent,
  row: BulkPublicationRowIntent,
  step: StepKind,
  backend: FakePlatformBackend,
  options: FakeOptions,
): BulkPublicationStepResult {
  const requested = options.publishOutcome?.(row, step) ?? 'auto';
  const alreadyConfirmed = matchingPublishedStep(row, step);
  const outcome = requested === 'auto' ? (alreadyConfirmed ? 'skipped' : 'published') : requested;

  if (outcome === 'skipped') {
    if (!alreadyConfirmed) {
      throw new Error(`Cannot skip ${step} without matching durable evidence.`);
    }
    return skippedResult(intent, row, step, {
      reason: 'already-confirmed',
      confirmed: alreadyConfirmed.confirmed,
      confirmedAt: alreadyConfirmed.confirmedAt,
    });
  }

  if (outcome === 'unknown') {
    const attemptId = `attempt-${row.rowId}-${step}`;
    const contentRevision = requiredIntendedRevision(row, step);
    backend.unknownAttempts.set(
      unknownKey(intent.batchId, row.rowId, row.sourceGeneration, step, attemptId),
      {
        key: unknownKey(intent.batchId, row.rowId, row.sourceGeneration, step, attemptId),
        batchId: intent.batchId,
        rowId: row.rowId,
        sourceGeneration: row.sourceGeneration,
        step,
        intent: stepIntent(intent, row, step),
        contentRevision,
        reference: null,
        attemptId,
        resolved: false,
      },
    );

    return {
      status: 'unknown',
      batchId: intent.batchId,
      rowId: row.rowId,
      sourceGeneration: row.sourceGeneration,
      step,
      intent: stepIntent(intent, row, step),
      contentRevision,
      attemptId,
    };
  }

  if (outcome === 'failed') {
    return {
      status: 'failed',
      batchId: intent.batchId,
      rowId: row.rowId,
      sourceGeneration: row.sourceGeneration,
      step,
      intent: stepIntent(intent, row, step),
      contentRevision: requiredIntendedRevision(row, step),
      attemptId: `attempt-${row.rowId}-${step}`,
      error: { code: `${step.toUpperCase()}_FAILED`, message: `${step} failed`, retryable: true },
    };
  }

  const revision = intendedRevision(row, step);
  if (!revision) {
    throw new Error(`Cannot publish ${step} without a content revision.`);
  }

  return {
    status: 'published',
    batchId: intent.batchId,
    rowId: row.rowId,
    sourceGeneration: row.sourceGeneration,
    step,
    intent: stepIntent(intent, row, step),
    contentRevision: revision,
    attemptId: `attempt-${row.rowId}-${step}`,
    reference: referenceFor(intent, row, step),
    confirmedContentRevision: revision,
    transactionSignature: `sig-${row.rowId}-${step}`,
    confirmedAt: '2026-08-21T00:00:00.000Z',
  };
}

function skippedResult(
  intent: BulkPublicationIntent,
  row: BulkPublicationRowIntent,
  step: StepKind,
  input:
    | { reason: 'not-required' | 'dependency-not-ready' }
    | {
        reason: 'already-confirmed';
        confirmed: BulkImportPublicationReference;
        confirmedAt: string;
      },
): BulkPublicationStepResult {
  const base = {
    batchId: intent.batchId,
    rowId: row.rowId,
    sourceGeneration: row.sourceGeneration,
    step,
  };

  if (input.reason === 'already-confirmed') {
    return {
      ...base,
      status: 'skipped',
      reason: 'already-confirmed',
      intent: stepIntent(intent, row, step),
      contentRevision: requiredIntendedRevision(row, step),
      confirmed: input.confirmed,
      confirmedAt: input.confirmedAt,
    };
  }

  return {
    ...base,
    status: 'skipped',
    reason: input.reason,
    intent: null,
    contentRevision: null,
  };
}

function reconcileBatch(
  intent: BulkPublicationIntent,
  backend: FakePlatformBackend,
  options: FakeOptions,
): BulkPublicationBatchResult {
  validateRoleIntent(intent);

  const rows = intent.rows.map((row) => {
    const unknownSteps = getUnknownPublicationSteps(row.publication);
    const steps: BulkPublicationStepResult[] = [];

    for (const { step, record } of unknownSteps) {
      if (record.sourceGeneration !== row.sourceGeneration) {
        throw new Error(
          `Cannot reconcile ${step} attempt ${record.attempt.attemptId} from source generation ${record.sourceGeneration} against generation ${row.sourceGeneration}.`,
        );
      }

      const key = unknownKey(
        intent.batchId,
        row.rowId,
        row.sourceGeneration,
        step,
        record.attempt.attemptId,
      );
      const attempt = backend.unknownAttempts.get(key);
      if (!attempt) {
        throw new Error(`Cannot reconcile ${step} without a recorded unknown attempt.`);
      }
      if (attempt.resolved) {
        throw new Error(`Unknown attempt ${record.attempt.attemptId} was already reconciled.`);
      }

      const outcome = options.reconcileOutcome?.(row, step, attempt) ?? 'published';
      if (outcome === 'unknown') {
        steps.push({
          status: 'unknown',
          batchId: intent.batchId,
          rowId: row.rowId,
          sourceGeneration: row.sourceGeneration,
          step,
          intent: attempt.intent,
          contentRevision: attempt.contentRevision,
          attemptId: attempt.attemptId,
        });
        continue;
      }

      attempt.resolved = true;
      if (outcome === 'failed') {
        steps.push({
          status: 'failed',
          batchId: intent.batchId,
          rowId: row.rowId,
          sourceGeneration: row.sourceGeneration,
          step,
          intent: attempt.intent,
          contentRevision: attempt.contentRevision,
          attemptId: attempt.attemptId,
          error: {
            code: `${step.toUpperCase()}_RECONCILE_FAILED`,
            message: `${step} reconcile failed`,
            retryable: false,
          },
        });
      } else {
        const revision = attempt.contentRevision;
        if (!revision) {
          throw new Error(`Cannot confirm ${step} without a content revision.`);
        }
        steps.push({
          status: 'published',
          batchId: intent.batchId,
          rowId: row.rowId,
          sourceGeneration: row.sourceGeneration,
          step,
          intent: attempt.intent,
          contentRevision: revision,
          attemptId: attempt.attemptId,
          reference: referenceFor(intent, row, step),
          confirmedContentRevision: revision,
          transactionSignature: `sig-reconciled-${row.rowId}-${step}`,
          confirmedAt: '2026-08-21T01:00:00.000Z',
        });
      }
    }

    return {
      batchId: intent.batchId,
      rowId: row.rowId,
      sourceGeneration: row.sourceGeneration,
      status: stepOutcomeToStatus(steps),
      steps,
    };
  });

  return {
    batchId: intent.batchId,
    rows,
    publishedCount: rows.filter((row) => row.status === 'complete').length,
    failedCount: rows.filter((row) => row.status === 'failed').length,
    unknownCount: rows.filter((row) => row.status === 'unknown').length,
  };
}

function makePublishedAudioJournal(row: BulkPublicationRowIntent, revision: string | null) {
  const journal = createEmptyPublicationJournal();
  if (revision) {
    journal.audio = createPublishedPublicationStep({
      intent: {
        kind: 'audio',
        service: 'AUDIO',
        name: 'Owner',
        identifier: `${row.rowId}-audio`,
      },
      confirmed: {
        service: 'AUDIO',
        name: 'Owner',
        identifier: `${row.rowId}-audio`,
      },
      contentRevision: revision,
      attemptId: 'attempt-audio',
      confirmedAt: '2026-08-21T00:00:00.000Z',
    });
  }
  return journal;
}

function makeUnknownJournal(
  intent: BulkPublicationIntent,
  row: BulkPublicationRowIntent,
  step: StepKind,
  attemptId: string,
): BulkImportPublicationJournal {
  const journal = createEmptyPublicationJournal();
  journal[step] = createUnknownPublicationStep({
    intent: stepIntent(intent, row, step),
    attemptId,
    contentRevision: requiredIntendedRevision(row, step),
    sourceGeneration: row.sourceGeneration,
    reference: null,
  });
  return journal;
}

describe('stateful bulk publication adapter contract', () => {
  it('binds duplicate filenames by rowId and source generation', async () => {
    const rows = [
      makeRowIntent('row-a', {
        source: { fileName: 'same.mp3', mimeType: 'audio/mpeg', sizeBytes: 10 },
        sourceGeneration: 2,
      }),
      makeRowIntent('row-b', {
        source: { fileName: 'same.mp3', mimeType: 'audio/mpeg', sizeBytes: 10 },
        sourceGeneration: 3,
      }),
    ];
    const intent = makeIntent('admin', rows);
    const { adapter } = createStatefulFakeAdapter();
    const acquisition = await adapter.acquirePublicationSources(intent);
    const shuffled = [acquisition.sources[1], acquisition.sources[0]];

    const result = await adapter.publishBatch(intent, shuffled);

    expect(result.batchId).toBe(intent.batchId);
    expect(result.rows.find((row) => row.rowId === 'row-a')?.sourceGeneration).toBe(2);
    expect(result.rows.find((row) => row.rowId === 'row-b')?.sourceGeneration).toBe(3);
    expect(
      result.rows.find((row) => row.rowId === 'row-a')?.steps.find((step) => step.step === 'audio')
        ?.status,
    ).toBe('published');
  });

  it('rejects shuffled sources that do not match the requested row binding', async () => {
    const intent = makeIntent('admin', [
      makeRowIntent('row-a', {
        source: { fileName: 'a.mp3', mimeType: 'audio/mpeg', sizeBytes: 10 },
      }),
      makeRowIntent('row-b', {
        source: { fileName: 'b.mp3', mimeType: 'audio/mpeg', sizeBytes: 20 },
      }),
    ]);
    const { adapter } = createStatefulFakeAdapter();
    const acquisition = await adapter.acquirePublicationSources(intent);
    const wrongBinding = acquisition.sources.map((source, index) => ({
      ...source,
      rowId: acquisition.sources[acquisition.sources.length - 1 - index].rowId,
    }));

    await expect(adapter.publishBatch(intent, wrongBinding)).rejects.toThrow(
      /unknown or stale row|Source set|Stale handle/,
    );
  });

  it('rejects a stale source generation and stale result identity', async () => {
    const intent = makeIntent('admin', [makeRowIntent('row-1', { sourceGeneration: 2 })]);
    const { adapter } = createStatefulFakeAdapter();
    const acquisition = await adapter.acquirePublicationSources(intent);

    const staleIntent: BulkPublicationIntent = {
      ...intent,
      rows: [makeRowIntent('row-1', { sourceGeneration: 3 })],
    };

    await expect(adapter.publishBatch(staleIntent, acquisition.sources)).rejects.toThrow(
      /unknown or stale row/,
    );

    const currentResult = await adapter.publishBatch(intent, acquisition.sources);
    expect(
      isBulkPublicationRowResultCurrent(currentResult.rows[0], intent.batchId, 'row-1', 3),
    ).toBe(false);
  });

  it('rejects a wrong batch result and keeps batch identity on every result', async () => {
    const intent = makeIntent('admin', [makeRowIntent('row-1')]);
    const { adapter } = createStatefulFakeAdapter();
    const acquisition = await adapter.acquirePublicationSources(intent);

    const wrongSource = { ...acquisition.sources[0], handleId: 'handle-other' };
    await expect(adapter.publishBatch(intent, [wrongSource])).rejects.toThrow(
      /Stale handle|Handle descriptor/,
    );

    const result = await adapter.publishBatch(intent, acquisition.sources);
    expect(isBulkPublicationRowResultCurrent(result.rows[0], 'wrong-batch', 'row-1', 0)).toBe(
      false,
    );
  });

  it('returns full success with evidence and content revisions', async () => {
    const intent = makeIntent('admin', [makeRowIntent('row-1')]);
    const { adapter } = createStatefulFakeAdapter();
    const acquisition = await adapter.acquirePublicationSources(intent);
    const result = await adapter.publishBatch(intent, acquisition.sources);

    expect(result.publishedCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect(result.unknownCount).toBe(0);
    expect(result.rows[0].status).toBe('complete');
    expect(result.rows[0].steps).toContainEqual(
      expect.objectContaining({
        step: 'audio',
        status: 'published',
        batchId: intent.batchId,
        rowId: 'row-1',
        sourceGeneration: 0,
        contentRevision: computeAudioContentRevision(
          intent.rows[0].source,
          intent.rows[0].sourceGeneration,
        ),
      }),
    );
  });

  it('retains each successful result across cross-row partial success', async () => {
    const rows = [makeRowIntent('row-1'), makeRowIntent('row-2'), makeRowIntent('row-3')];
    const intent = makeIntent('admin', rows);
    const { adapter } = createStatefulFakeAdapter({
      publishOutcome: (row) =>
        row.rowId === 'row-2' ? 'failed' : row.rowId === 'row-3' ? 'unknown' : 'published',
    });
    const acquisition = await adapter.acquirePublicationSources(intent);
    const result = await adapter.publishBatch(intent, acquisition.sources);

    expect(result.rows.find((row) => row.rowId === 'row-1')?.status).toBe('complete');
    expect(result.rows.find((row) => row.rowId === 'row-2')?.status).toBe('failed');
    expect(result.rows.find((row) => row.rowId === 'row-3')?.status).toBe('unknown');
    expect(
      result.rows
        .find((row) => row.rowId === 'row-1')
        ?.steps.filter((step) => step.status === 'published'),
    ).toHaveLength(2);
  });

  it('represents per-resource partial success inside one row', async () => {
    const intent = makeIntent('admin', [
      makeRowIntent('row-1', {
        cover: { origin: 'manual', fileName: 'c.jpg', mimeType: 'image/jpeg', sizeBytes: 1 },
      }),
    ]);
    const { adapter } = createStatefulFakeAdapter({
      publishOutcome: (_row, step) => (step === 'cover' ? 'failed' : 'published'),
    });
    const acquisition = await adapter.acquirePublicationSources(intent);
    const result = await adapter.publishBatch(intent, acquisition.sources);

    expect(result.rows[0].status).toBe('failed');
    expect(result.rows[0].steps.filter((step) => step.status === 'published')).toHaveLength(2);
    expect(result.rows[0].steps.find((step) => step.step === 'cover')?.status).toBe('failed');
  });

  it('creates durable unknown attempt evidence', async () => {
    const intent = makeIntent('admin', [makeRowIntent('row-1')]);
    const { adapter, backend } = createStatefulFakeAdapter({
      publishOutcome: (_row, step) => (step === 'metadata' ? 'unknown' : 'published'),
    });
    const acquisition = await adapter.acquirePublicationSources(intent);
    await adapter.publishBatch(intent, acquisition.sources);

    const unknown = [...backend.unknownAttempts.values()].find(
      (entry) => entry.step === 'metadata',
    );
    expect(unknown).toBeTruthy();
    expect(unknown?.batchId).toBe(intent.batchId);
    expect(unknown?.rowId).toBe('row-1');
    expect(unknown?.sourceGeneration).toBe(0);
    expect(unknown?.contentRevision).toBe(computeMetadataContentRevision(intent.rows[0].metadata));
  });

  it('reconciles a recorded unknown attempt to published', async () => {
    const intent = makeIntent('admin', [makeRowIntent('row-1')]);
    const { adapter } = createStatefulFakeAdapter({
      publishOutcome: (_row, step) => (step === 'metadata' ? 'unknown' : 'published'),
    });
    const acquisition = await adapter.acquirePublicationSources(intent);
    await adapter.publishBatch(intent, acquisition.sources);

    const unknownJournal = makeUnknownJournal(
      intent,
      intent.rows[0],
      'metadata',
      'attempt-row-1-metadata',
    );
    const reconcileIntent: BulkPublicationIntent = {
      ...intent,
      rows: [
        makeRowIntent('row-1', {
          publication: unknownJournal,
        }),
      ],
    };

    const result = await adapter.reconcileBatch(reconcileIntent);
    expect(result.rows[0].status).toBe('complete');
    expect(result.rows[0].steps[0]).toMatchObject({
      status: 'published',
      step: 'metadata',
      attemptId: 'attempt-row-1-metadata',
    });
  });

  it('reconciles a recorded unknown attempt to failed', async () => {
    const intent = makeIntent('admin', [makeRowIntent('row-1')]);
    const { adapter } = createStatefulFakeAdapter({
      publishOutcome: (_row, step) => (step === 'metadata' ? 'unknown' : 'published'),
      reconcileOutcome: () => 'failed',
    });
    const acquisition = await adapter.acquirePublicationSources(intent);
    await adapter.publishBatch(intent, acquisition.sources);

    const unknownJournal = makeUnknownJournal(
      intent,
      intent.rows[0],
      'metadata',
      'attempt-row-1-metadata',
    );
    const reconcileIntent: BulkPublicationIntent = {
      ...intent,
      rows: [makeRowIntent('row-1', { publication: unknownJournal })],
    };

    const result = await adapter.reconcileBatch(reconcileIntent);

    expect(result.rows[0].status).toBe('failed');
    expect(result.rows[0].steps[0].status).toBe('failed');
    expect(result.rows[0].steps[0]).toMatchObject({
      attemptId: 'attempt-row-1-metadata',
    });
  });

  it('consumes the recorded unknown attempt and rejects a second reconciliation', async () => {
    const intent = makeIntent('admin', [makeRowIntent('row-1')]);
    const { adapter } = createStatefulFakeAdapter({
      publishOutcome: (_row, step) => (step === 'metadata' ? 'unknown' : 'published'),
    });
    const acquisition = await adapter.acquirePublicationSources(intent);
    await adapter.publishBatch(intent, acquisition.sources);

    const unknownJournal = makeUnknownJournal(
      intent,
      intent.rows[0],
      'metadata',
      'attempt-row-1-metadata',
    );
    const reconcileIntent: BulkPublicationIntent = {
      ...intent,
      rows: [makeRowIntent('row-1', { publication: unknownJournal })],
    };

    await adapter.reconcileBatch(reconcileIntent);
    await expect(adapter.reconcileBatch(reconcileIntent)).rejects.toThrow(/already reconciled/);
  });

  it('requires matching evidence for an already-confirmed skip', async () => {
    const row = makeRowIntent('row-1');
    const journal = createEmptyPublicationJournal();
    journal.audio = createPublishedPublicationStep({
      intent: {
        kind: 'audio',
        service: 'AUDIO',
        name: 'Owner',
        identifier: 'row-1-audio',
      },
      confirmed: {
        service: 'AUDIO',
        name: 'Owner',
        identifier: 'row-1-audio',
      },
      contentRevision: computeAudioContentRevision(row.source, row.sourceGeneration) ?? '',
      attemptId: 'attempt-audio',
      confirmedAt: '2026-08-21T00:00:00.000Z',
    });
    const intent = makeIntent('admin', [makeRowIntent('row-1', { publication: journal })]);
    const { adapter } = createStatefulFakeAdapter({
      publishOutcome: (_row, step) => (step === 'audio' ? 'skipped' : 'published'),
    });
    const acquisition = await adapter.acquirePublicationSources(intent);

    const result = await adapter.publishBatch(intent, acquisition.sources);
    const audio = result.rows[0].steps.find((step) => step.step === 'audio');
    expect(audio).toMatchObject({
      status: 'skipped',
      reason: 'already-confirmed',
      contentRevision: computeAudioContentRevision(
        intent.rows[0].source,
        intent.rows[0].sourceGeneration,
      ),
    });
  });

  it('does not allow stale evidence to produce an already-confirmed skip', async () => {
    const row = makeRowIntent('row-1');
    const staleJournal = makePublishedAudioJournal(row, 'stale-revision');
    const intent = makeIntent('admin', [
      makeRowIntent('row-1', {
        publication: staleJournal,
      }),
    ]);
    const { adapter } = createStatefulFakeAdapter({
      publishOutcome: (_row, step) => (step === 'audio' ? 'skipped' : 'published'),
    });
    const acquisition = await adapter.acquirePublicationSources(intent);

    await expect(adapter.publishBatch(intent, acquisition.sources)).rejects.toThrow(
      /Cannot skip audio without matching durable evidence/,
    );
  });

  it('enforces one-shot handle consumption', async () => {
    const intent = makeIntent('admin', [makeRowIntent('row-1')]);
    const { adapter } = createStatefulFakeAdapter();
    const acquisition = await adapter.acquirePublicationSources(intent);
    await adapter.publishBatch(intent, acquisition.sources);

    await expect(adapter.publishBatch(intent, acquisition.sources)).rejects.toThrow(
      /already consumed/,
    );
  });

  it('requires reacquisition after a handle is consumed', async () => {
    const intent = makeIntent('admin', [makeRowIntent('row-1')]);
    const { adapter } = createStatefulFakeAdapter();
    const first = await adapter.acquirePublicationSources(intent);
    await adapter.publishBatch(intent, first.sources);

    const second = await adapter.acquirePublicationSources(intent);
    expect(second.sources).toHaveLength(1);
    expect(second.sources[0].handleId).not.toBe(first.sources[0].handleId);
    await expect(adapter.publishBatch(intent, second.sources)).resolves.toMatchObject({
      batchId: intent.batchId,
    });
  });

  it('handles an absent optional cover as not-required', async () => {
    const intent = makeIntent('admin', [makeRowIntent('row-1')]);
    const { adapter } = createStatefulFakeAdapter();
    const acquisition = await adapter.acquirePublicationSources(intent);
    const result = await adapter.publishBatch(intent, acquisition.sources);

    expect(result.rows[0].steps.find((step) => step.step === 'cover')).toMatchObject({
      status: 'skipped',
      reason: 'not-required',
    });
  });

  it('publishes an optional cover when present', async () => {
    const intent = makeIntent('admin', [
      makeRowIntent('row-1', {
        cover: { origin: 'manual', fileName: 'c.jpg', mimeType: 'image/jpeg', sizeBytes: 5 },
      }),
    ]);
    const { adapter } = createStatefulFakeAdapter();
    const acquisition = await adapter.acquirePublicationSources(intent);
    const result = await adapter.publishBatch(intent, acquisition.sources);

    expect(result.rows[0].steps.find((step) => step.step === 'cover')?.status).toBe('published');
  });

  it('uses current revisions so a metadata edit makes prior evidence stale', async () => {
    const row = makeRowIntent('row-1');
    const journal = makePublishedAudioJournal(row, computeMetadataContentRevision(row.metadata));
    const intent = makeIntent('admin', [
      makeRowIntent('row-1', {
        metadata: { ...row.metadata, title: 'Edited' },
        publication: journal,
      }),
    ]);
    const { adapter } = createStatefulFakeAdapter();
    const acquisition = await adapter.acquirePublicationSources(intent);
    const result = await adapter.publishBatch(intent, acquisition.sources);
    const metadata = result.rows[0].steps.find((step) => step.step === 'metadata');

    expect(metadata?.status).toBe('published');
    expect(metadata?.contentRevision).toBe(computeMetadataContentRevision(intent.rows[0].metadata));
    expect(metadata?.contentRevision).not.toBe(computeMetadataContentRevision(row.metadata));
  });

  it('uses current revisions so a cover edit makes prior evidence stale', async () => {
    const oldCover = {
      origin: 'manual' as const,
      fileName: 'old.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 5,
    };
    const journal = createEmptyPublicationJournal();
    journal.cover = createPublishedPublicationStep({
      intent: { kind: 'cover', service: 'IMAGE', name: 'Owner', identifier: 'row-1-cover' },
      confirmed: { service: 'IMAGE', name: 'Owner', identifier: 'row-1-cover' },
      contentRevision: computeCoverContentRevision(coverToDraft(oldCover)) ?? '',
      attemptId: 'attempt-cover',
      confirmedAt: '2026-08-21T00:00:00.000Z',
    });
    const intent = makeIntent('admin', [
      makeRowIntent('row-1', {
        cover: { origin: 'manual', fileName: 'new.jpg', mimeType: 'image/jpeg', sizeBytes: 10 },
        publication: journal,
      }),
    ]);
    const { adapter } = createStatefulFakeAdapter();
    const acquisition = await adapter.acquirePublicationSources(intent);
    const result = await adapter.publishBatch(intent, acquisition.sources);
    const cover = result.rows[0].steps.find((step) => step.step === 'cover');

    expect(cover?.status).toBe('published');
    expect(cover?.contentRevision).toBe(
      computeCoverContentRevision(coverToDraft(intent.rows[0].cover!)),
    );
  });

  it('uses current revisions so audio replacement makes prior evidence stale', async () => {
    const row = makeRowIntent('row-1');
    const oldSource = row.source!;
    const journal = makePublishedAudioJournal(
      row,
      computeAudioContentRevision(oldSource, row.sourceGeneration),
    );
    const intent = makeIntent('admin', [
      makeRowIntent('row-1', {
        source: { fileName: 'new.mp3', mimeType: 'audio/mpeg', sizeBytes: 999 },
        publication: journal,
      }),
    ]);
    const { adapter } = createStatefulFakeAdapter();
    const acquisition = await adapter.acquirePublicationSources(intent);
    const result = await adapter.publishBatch(intent, acquisition.sources);
    const audio = result.rows[0].steps.find((step) => step.step === 'audio');

    expect(audio?.status).toBe('published');
    expect(audio?.contentRevision).toBe(
      computeAudioContentRevision(intent.rows[0].source, intent.rows[0].sourceGeneration),
    );
    expect(audio?.contentRevision).not.toBe(
      computeAudioContentRevision(oldSource, row.sourceGeneration),
    );
  });

  it('keeps Listener intent as Submission and Admin intent as Track', () => {
    expect(mapBulkImportRoleToPublicationIntent('listener')).toBe('submission');
    expect(mapBulkImportRoleToPublicationIntent('admin')).toBe('track');
  });

  it('rejects a row role intent inconsistent with the batch role', async () => {
    const listenerIntent = makeIntent('listener', [
      makeRowIntent('row-1', { roleIntent: 'track' }),
    ]);
    const { adapter } = createStatefulFakeAdapter();

    await expect(adapter.acquirePublicationSources(listenerIntent)).rejects.toThrow(
      /Inconsistent role intent/,
    );
  });

  it('does not mutate client role intent and never treats role as authority', async () => {
    const listenerIntent = makeIntent('listener', [
      makeRowIntent('row-1', { roleIntent: 'submission' }),
    ]);
    const before = JSON.stringify(listenerIntent);
    const { adapter } = createStatefulFakeAdapter();
    const acquisition = await adapter.acquirePublicationSources(listenerIntent);
    await adapter.publishBatch(listenerIntent, acquisition.sources);

    expect(JSON.stringify(listenerIntent)).toBe(before);
    expect(listenerIntent.role).toBe('listener');
    expect(listenerIntent.rows[0].roleIntent).toBe('submission');
  });

  it('rejects a duplicate handle and a missing handle', async () => {
    const intent = makeIntent('admin', [makeRowIntent('row-1'), makeRowIntent('row-2')]);
    const { adapter } = createStatefulFakeAdapter();
    const acquisition = await adapter.acquirePublicationSources(intent);

    await expect(
      adapter.publishBatch(intent, [acquisition.sources[0], acquisition.sources[0]]),
    ).rejects.toThrow(/Duplicate source/);

    const missing = { ...acquisition.sources[0], handleId: 'missing-handle' };
    await expect(adapter.publishBatch(intent, [missing, acquisition.sources[1]])).rejects.toThrow(
      /Stale handle/,
    );
  });

  it('rejects a result with the wrong batch or generation when checked directly', () => {
    const row = makeRowIntent('row-1');
    const result: BulkPublicationStepResult = {
      status: 'published',
      batchId: 'other-batch',
      rowId: 'row-1',
      sourceGeneration: 0,
      step: 'audio',
      intent: { kind: 'audio', service: 'AUDIO', name: 'Owner', identifier: 'row-1-audio' },
      contentRevision: computeAudioContentRevision(row.source, row.sourceGeneration) ?? '',
      attemptId: 'attempt-audio',
      reference: { service: 'AUDIO', name: 'Owner', identifier: 'row-1-audio' },
      confirmedContentRevision: computeAudioContentRevision(row.source, row.sourceGeneration) ?? '',
      transactionSignature: null,
      confirmedAt: '2026-08-21T00:00:00.000Z',
    };

    expect(isBulkPublicationStepResultCurrent(result, 'batch-1', 'row-1', 0)).toBe(false);
    expect(isBulkPublicationStepResultCurrent(result, 'other-batch', 'row-1', 1)).toBe(false);
    expect(
      isBulkPublicationStepResultCurrent(result, 'other-batch', 'row-1', 0, 'wrong-revision'),
    ).toBe(false);
  });

  it('invalidates a generation-only audio already-confirmed skip', async () => {
    const oldRow = makeRowIntent('row-1', { sourceGeneration: 2 });
    const journal = makePublishedAudioJournal(
      oldRow,
      computeAudioContentRevision(oldRow.source, oldRow.sourceGeneration),
    );
    const intent = makeIntent('admin', [
      makeRowIntent('row-1', {
        sourceGeneration: 3,
        publication: journal,
      }),
    ]);
    const { adapter } = createStatefulFakeAdapter({
      publishOutcome: (_row, step) => (step === 'audio' ? 'skipped' : 'published'),
    });
    const acquisition = await adapter.acquirePublicationSources(intent);

    await expect(adapter.publishBatch(intent, acquisition.sources)).rejects.toThrow(
      /Cannot skip audio without matching durable evidence/,
    );
  });

  it('classifies a published result with contradictory confirmation as stale', () => {
    const row = makeRowIntent('row-1');
    const revision = computeAudioContentRevision(row.source, row.sourceGeneration) ?? '';
    const result: BulkPublicationStepResult = {
      status: 'published',
      batchId: 'batch-1',
      rowId: 'row-1',
      sourceGeneration: 0,
      step: 'audio',
      intent: { kind: 'audio', service: 'AUDIO', name: 'Owner', identifier: 'row-1-audio' },
      contentRevision: revision,
      attemptId: 'attempt-audio',
      reference: { service: 'AUDIO', name: 'Owner', identifier: 'row-1-audio' },
      confirmedContentRevision: 'previous-revision',
      transactionSignature: null,
      confirmedAt: '2026-08-21T00:00:00.000Z',
    };

    const validation = validateBulkPublicationStepResultAgainstCurrentRow(result, {
      batchId: 'batch-1',
      rowId: 'row-1',
      sourceGeneration: 0,
      step: 'audio',
      requiredContentRevision: revision,
    });

    expect(validation.classification).toBe('contradictory-confirmation');
    expect(isBulkPublicationStepResultCurrent(result, 'batch-1', 'row-1', 0, revision)).toBe(false);
  });

  it('classifies every current-row validation category', () => {
    const row = makeRowIntent('row-1');
    const revision = computeAudioContentRevision(row.source, row.sourceGeneration) ?? '';
    const current = {
      batchId: 'batch-1',
      rowId: 'row-1',
      sourceGeneration: 0,
      step: 'audio' as const,
      requiredContentRevision: revision,
    };
    const base: BulkPublicationStepResult = {
      status: 'published',
      batchId: current.batchId,
      rowId: current.rowId,
      sourceGeneration: current.sourceGeneration,
      step: current.step,
      intent: { kind: 'audio', service: 'AUDIO', name: 'Owner', identifier: 'row-1-audio' },
      contentRevision: revision,
      attemptId: 'attempt-audio',
      reference: { service: 'AUDIO', name: 'Owner', identifier: 'row-1-audio' },
      confirmedContentRevision: revision,
      transactionSignature: null,
      confirmedAt: '2026-08-21T00:00:00.000Z',
    };

    const cases: Array<{
      result: BulkPublicationStepResult;
      classification: ReturnType<
        typeof validateBulkPublicationStepResultAgainstCurrentRow
      >['classification'];
    }> = [
      { result: base, classification: 'current-valid' },
      { result: { ...base, batchId: 'batch-2' }, classification: 'stale-batch' },
      { result: { ...base, rowId: 'row-2' }, classification: 'stale-row' },
      { result: { ...base, sourceGeneration: 1 }, classification: 'stale-generation' },
      {
        result: {
          ...base,
          contentRevision: 'stale-revision',
          confirmedContentRevision: 'stale-revision',
        },
        classification: 'stale-revision',
      },
      {
        result: {
          ...base,
          intent: { kind: 'cover', service: 'IMAGE', name: 'Owner', identifier: 'x' },
        },
        classification: 'wrong-resource-kind',
      },
      {
        result: { ...base, attemptId: '' } as unknown as BulkPublicationStepResult,
        classification: 'malformed-result',
      },
    ];

    for (const item of cases) {
      expect(
        validateBulkPublicationStepResultAgainstCurrentRow(item.result, current).classification,
      ).toBe(item.classification);
    }
  });

  it('classifies resource results missing identity fields as malformed', () => {
    const row = makeRowIntent('row-1');
    const revision = computeAudioContentRevision(row.source, row.sourceGeneration) ?? '';
    const malformed = {
      status: 'failed',
      batchId: 'batch-1',
      rowId: 'row-1',
      sourceGeneration: 0,
      step: 'audio',
      intent: null,
      contentRevision: null,
      attemptId: null,
      error: null,
    } as unknown as BulkPublicationStepResult;

    const validation = validateBulkPublicationStepResultAgainstCurrentRow(malformed, {
      batchId: 'batch-1',
      rowId: 'row-1',
      sourceGeneration: 0,
      step: 'audio',
      requiredContentRevision: revision,
    });

    expect(validation.classification).toBe('wrong-resource-kind');
  });

  describe('runtime validation of nested result evidence', () => {
    const row = makeRowIntent('row-1');
    const revision = computeAudioContentRevision(row.source, row.sourceGeneration) ?? '';
    const current = {
      batchId: 'batch-1',
      rowId: 'row-1',
      sourceGeneration: 0,
      step: 'audio' as const,
      requiredContentRevision: revision,
    };

    const validPublished = (): BulkPublicationStepResult => ({
      status: 'published',
      batchId: current.batchId,
      rowId: current.rowId,
      sourceGeneration: current.sourceGeneration,
      step: current.step,
      intent: { kind: 'audio', service: 'AUDIO', name: 'Owner', identifier: 'row-1-audio' },
      contentRevision: revision,
      attemptId: 'attempt-audio',
      reference: { service: 'AUDIO', name: 'Owner', identifier: 'row-1-audio' },
      confirmedContentRevision: revision,
      transactionSignature: null,
      confirmedAt: '2026-08-21T00:00:00.000Z',
    });

    const validFailed = (): BulkPublicationStepResult => ({
      status: 'failed',
      batchId: current.batchId,
      rowId: current.rowId,
      sourceGeneration: current.sourceGeneration,
      step: current.step,
      intent: { kind: 'audio', service: 'AUDIO', name: 'Owner', identifier: 'row-1-audio' },
      contentRevision: revision,
      attemptId: 'attempt-audio',
      error: { code: 'AUDIO_FAILED', message: 'audio failed', retryable: true },
    });

    const validUnknown = (): BulkPublicationStepResult => ({
      status: 'unknown',
      batchId: current.batchId,
      rowId: current.rowId,
      sourceGeneration: current.sourceGeneration,
      step: current.step,
      intent: { kind: 'audio', service: 'AUDIO', name: 'Owner', identifier: 'row-1-audio' },
      contentRevision: revision,
      attemptId: 'attempt-audio',
    });

    const classification = (result: BulkPublicationStepResult) =>
      validateBulkPublicationStepResultAgainstCurrentRow(result, current).classification;

    it('accepts a published result with a valid reference', () => {
      expect(classification(validPublished())).toBe('current-valid');
    });

    it('rejects the exact published malformed reference challenge as malformed', () => {
      expect(
        classification({
          ...validPublished(),
          reference: {},
        } as unknown as BulkPublicationStepResult),
      ).toBe('malformed-result');
    });

    it('rejects a published result whose reference is missing a required field', () => {
      expect(
        classification({
          ...validPublished(),
          reference: { service: 'AUDIO' },
        } as unknown as BulkPublicationStepResult),
      ).toBe('malformed-result');
    });

    it('rejects a published result with a malformed confirmation timestamp', () => {
      expect(
        classification({
          ...validPublished(),
          confirmedAt: '',
        } as unknown as BulkPublicationStepResult),
      ).toBe('malformed-result');
    });

    it('rejects a published result with a malformed nested intent shape', () => {
      expect(
        classification({
          ...validPublished(),
          intent: { kind: 'audio' },
        } as unknown as BulkPublicationStepResult),
      ).toBe('malformed-result');
    });

    it('accepts a failed result with a valid classified error', () => {
      expect(classification(validFailed())).toBe('current-valid');
    });

    it('rejects the exact failed malformed error challenge as malformed', () => {
      expect(
        classification({
          ...validFailed(),
          error: {},
        } as unknown as BulkPublicationStepResult),
      ).toBe('malformed-result');
    });

    it('rejects a failed result whose error is missing a code', () => {
      expect(
        classification({
          ...validFailed(),
          error: { message: 'audio failed', retryable: true },
        } as unknown as BulkPublicationStepResult),
      ).toBe('malformed-result');
    });

    it('rejects a failed result whose error is missing a message', () => {
      expect(
        classification({
          ...validFailed(),
          error: { code: 'AUDIO_FAILED', retryable: true },
        } as unknown as BulkPublicationStepResult),
      ).toBe('malformed-result');
    });

    it('rejects a failed result whose error has a non-boolean retryable value', () => {
      expect(
        classification({
          ...validFailed(),
          error: { code: 'AUDIO_FAILED', message: 'audio failed', retryable: 'yes' },
        } as unknown as BulkPublicationStepResult),
      ).toBe('malformed-result');
    });

    it('accepts a current unknown result', () => {
      expect(classification(validUnknown())).toBe('current-valid');
    });

    it('rejects an unknown result with malformed nested intent evidence', () => {
      expect(
        classification({
          ...validUnknown(),
          intent: { kind: 'audio' },
        } as unknown as BulkPublicationStepResult),
      ).toBe('malformed-result');
    });
  });

  it('submits an acquired batch-A handle under batch B and rejects it', async () => {
    const intentA = makeIntent('admin', [makeRowIntent('row-1')]);
    const { adapter } = createStatefulFakeAdapter();
    const acquisitionA = await adapter.acquirePublicationSources(intentA);

    const intentB: BulkPublicationIntent = {
      ...intentA,
      batchId: 'batch-2',
    };

    await expect(adapter.publishBatch(intentB, acquisitionA.sources)).rejects.toThrow(
      /Missing acquisition handle for row row-1/,
    );
  });

  it('returns an explicit no-op for reconciliation without unknown work', async () => {
    const intent = makeIntent('admin', [makeRowIntent('row-1')]);
    const { adapter } = createStatefulFakeAdapter();
    const result = await adapter.reconcileBatch(intent);

    expect(result.rows[0].status).toBe('no-op');
    expect(result.rows[0].steps).toEqual([]);
  });

  it('rejects reconciliation of a stale-generation unknown attempt', async () => {
    const backend = createFakePlatformBackend();
    const generation2 = makeRowIntent('row-1', { sourceGeneration: 2 });
    const { adapter } = createStatefulFakeAdapterWithBackend(backend, {
      publishOutcome: (_row, step) => (step === 'metadata' ? 'unknown' : 'published'),
    });
    const acquisition = await adapter.acquirePublicationSources(makeIntent('admin', [generation2]));
    await adapter.publishBatch(makeIntent('admin', [generation2]), acquisition.sources);

    const unknownStep = [...backend.unknownAttempts.values()].find(
      (entry) => entry.step === 'metadata',
    );
    const unknownJournal = makeUnknownJournal(
      makeIntent('admin', [generation2]),
      generation2,
      'metadata',
      unknownStep?.attemptId ?? 'attempt-row-1-metadata',
    );
    const reconcileIntent = makeIntent('admin', [
      makeRowIntent('row-1', {
        sourceGeneration: 3,
        publication: unknownJournal,
      }),
    ]);

    await expect(adapter.reconcileBatch(reconcileIntent)).rejects.toThrow(
      /from source generation 2 against generation 3/,
    );
  });

  it('reconciles from only durable journal evidence after adapter recreation', async () => {
    const backend = createFakePlatformBackend();
    const initialIntent = makeIntent('admin', [makeRowIntent('row-1')]);
    const first = createStatefulFakeAdapterWithBackend(backend, {
      publishOutcome: (_row, step) => (step === 'metadata' ? 'unknown' : 'published'),
    });
    const acquisition = await first.adapter.acquirePublicationSources(initialIntent);
    const published = await first.adapter.publishBatch(initialIntent, acquisition.sources);

    const unknownStep = published.rows[0].steps.find(
      (step) => step.status === 'unknown' && step.step === 'metadata',
    ) as Extract<BulkPublicationStepResult, { status: 'unknown' }> | undefined;
    if (!unknownStep) throw new Error('Expected durable unknown metadata step.');

    const durableJournal = makeUnknownJournal(
      initialIntent,
      initialIntent.rows[0],
      'metadata',
      unknownStep.attemptId,
    );
    const batch = batchFromPublicationIntent({
      ...initialIntent,
      rows: [
        {
          ...initialIntent.rows[0],
          publication: durableJournal,
        },
      ],
    });
    const restored = deserializeBulkImportBatch(
      serializeBulkImportBatch(batch),
      'admin',
      'owner-scope',
    );
    if (!restored) throw new Error('Durable journal did not survive reload.');

    const reloadedIntent = publicationIntentFromBatch(restored, 'admin', 'owner-scope');
    const second = createStatefulFakeAdapterWithBackend(backend);
    const result = await second.adapter.reconcileBatch(reloadedIntent);

    expect(result.rows[0].status).toBe('complete');
    expect(result.rows[0].steps[0]).toMatchObject({
      status: 'published',
      step: 'metadata',
      attemptId: unknownStep.attemptId,
    });
  });
});
