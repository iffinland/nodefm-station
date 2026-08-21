import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBulkImportBatch, createBulkImportRow } from './batchStore';
import { computeAudioContentRevision } from './contentRevision';
import {
  createEmptyPublicationJournal,
  createPublishedPublicationStep,
  createUnknownPublicationStep,
} from './publicationJournal';
import {
  clearBulkImportBatch,
  deserializeBulkImportBatch,
  loadBulkImportBatch,
  saveBulkImportBatch,
  serializeBulkImportBatch,
} from './services/bulkImportStorage';
import { getBulkImportPublicationStatus } from './selectors';
import type { BulkImportBatch, BulkImportRow } from './types';

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function makeBatchWithCover(): BulkImportBatch {
  const journal = createEmptyPublicationJournal();
  journal.source.status = 'acquired';
  journal.audio = createPublishedPublicationStep({
    intent: { kind: 'audio', service: 'AUDIO', name: 'Owner', identifier: 'audio-id' },
    confirmed: { service: 'AUDIO', name: 'Owner', identifier: 'audio-id' },
    contentRevision: 'revision-audio',
    attemptId: 'attempt-audio',
    confirmedAt: '2026-08-21T00:00:00.000Z',
  });
  journal.cover = createUnknownPublicationStep({
    intent: { kind: 'cover', service: 'IMAGE', name: 'Owner', identifier: 'cover-id' },
    attemptId: 'attempt-cover',
    contentRevision: 'revision-cover',
    sourceGeneration: 0,
  });
  journal.metadata = createPublishedPublicationStep({
    intent: { kind: 'metadata', service: 'JSON', name: 'Owner', identifier: 'metadata-id' },
    confirmed: { service: 'JSON', name: 'Owner', identifier: 'metadata-id' },
    contentRevision: 'revision-metadata',
    attemptId: 'attempt-metadata',
    confirmedAt: '2026-08-21T00:00:00.000Z',
  });

  const row: BulkImportRow = {
    ...createBulkImportRow({
      id: 'row-1',
      fileName: 'Artist - Title.mp3',
      mimeType: 'audio/mpeg',
      sizeBytes: 123,
    }),
    cover: {
      origin: 'embedded',
      fileName: 'cover.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 99,
      previewUrl: 'blob:nodefm-preview',
    },
    coverSourceAvailable: true,
    publication: journal,
  };

  return {
    ...createBulkImportBatch('admin', 'owner-scope', { id: 'batch-1' }),
    rows: [row],
  };
}

function makeLegacyBatch(publication: Record<string, unknown>): unknown {
  return {
    schemaVersion: 1,
    id: 'batch-legacy',
    role: 'admin',
    scope: 'owner-scope',
    createdAt: '2026-08-21T00:00:00.000Z',
    updatedAt: '2026-08-21T00:00:00.000Z',
    rows: [
      {
        id: 'row-1',
        selected: true,
        localSource: { fileName: 'A - B.mp3', mimeType: 'audio/mpeg', sizeBytes: 123 },
        localSourceAvailable: true,
        metadata: {
          artist: 'A',
          title: 'B',
          album: '',
          releaseDate: '',
          genres: [],
          tags: [],
        },
        manualFields: [],
        provenance: {
          artist: 'filename',
          title: 'filename',
          album: 'none',
          releaseDate: 'none',
          genres: 'none',
          tags: 'none',
        },
        durationMs: 120000,
        durationSource: 'embedded',
        cover: null,
        extraction: { status: 'complete' },
        publication,
      },
    ],
  };
}

function mutateSerializedStep(
  stepKey: 'audio' | 'cover' | 'metadata',
  step: Record<string, unknown>,
) {
  const batch = makeBatchWithCover();
  const parsed = JSON.parse(serializeBulkImportBatch(batch)) as {
    rows: Array<{
      publication: Record<string, unknown>;
    }>;
  };
  parsed.rows[0].publication[stepKey] = step;
  return deserializeBulkImportBatch(JSON.stringify(parsed), 'admin', 'owner-scope');
}

function completePublishedStep(kind: 'audio' | 'cover' | 'metadata') {
  return {
    status: 'published',
    intent: {
      kind,
      service: kind === 'audio' ? 'AUDIO' : kind === 'cover' ? 'IMAGE' : 'JSON',
      name: 'Owner',
      identifier: `${kind}-id`,
    },
    confirmed: {
      service: kind === 'audio' ? 'AUDIO' : kind === 'cover' ? 'IMAGE' : 'JSON',
      name: 'Owner',
      identifier: `${kind}-id`,
    },
    contentRevision: 'revision-current',
    attempt: { attemptId: 'attempt-id', startedAt: null, finishedAt: null },
    transactionSignature: null,
    confirmedAt: '2026-08-21T00:00:00.000Z',
    updatedAt: '2026-08-21T00:00:00.000Z',
  };
}

describe('bulk import session storage', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { sessionStorage: new MemoryStorage() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('serializes with an allowlisted DTO and drops transient handles and flags', () => {
    const batch = makeBatchWithCover();
    const batchWithUnknownHandle = {
      ...batch,
      rows: batch.rows.map((row) => ({
        ...row,
        sourceHandle: 'opaque-future-handle',
        adapterScratch: { arbitrary: true },
      })),
    } as unknown as BulkImportBatch;

    const serialized = serializeBulkImportBatch(batchWithUnknownHandle);
    const parsed = JSON.parse(serialized) as {
      rows: Array<Record<string, unknown>>;
    };

    expect(serialized).not.toContain('blob:nodefm-preview');
    expect(serialized).not.toContain('opaque-future-handle');
    expect(serialized).not.toContain('adapterScratch');
    expect(parsed.rows[0]).not.toHaveProperty('audioSourceAvailable');
    expect(parsed.rows[0]).not.toHaveProperty('coverSourceAvailable');
    expect(parsed.rows[0]).not.toHaveProperty('sourceHandle');
    expect(parsed.rows[0].cover).toEqual({
      origin: 'embedded',
      fileName: 'cover.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 99,
    });
  });

  it('round-trips safe state and marks reloaded transient sources unavailable', () => {
    const serialized = serializeBulkImportBatch(makeBatchWithCover());
    const restored = deserializeBulkImportBatch(serialized, 'admin', 'owner-scope');

    expect(restored).not.toBeNull();
    expect(restored?.schemaVersion).toBe(2);
    expect(restored?.rows[0].audioSourceAvailable).toBe(false);
    expect(restored?.rows[0].coverSourceAvailable).toBe(false);
    expect(restored?.rows[0].cover?.previewUrl).toBeNull();
    expect(restored?.rows[0].publication.cover.status).toBe('unknown');
    expect(restored?.rows[0].publication.audio.status).toBe('published');
  });

  it('does not claim an acquired native source remains usable after reload', () => {
    const serialized = serializeBulkImportBatch(makeBatchWithCover());
    const restored = deserializeBulkImportBatch(serialized, 'admin', 'owner-scope');

    expect(restored?.rows[0].publication.source.status).toBe('not-started');
  });

  it('keeps unknown journal state distinct from confirmed failure', () => {
    const restored = deserializeBulkImportBatch(
      serializeBulkImportBatch(makeBatchWithCover()),
      'admin',
      'owner-scope',
    );

    expect(restored?.rows[0].publication.cover.status).toBe('unknown');
    expect(restored?.rows[0].publication.cover.status).not.toBe('failed');
  });

  it('migrates a legacy v1 bare-string journal into the versioned journal', () => {
    const legacy = {
      schemaVersion: 1,
      id: 'batch-legacy',
      role: 'admin',
      scope: 'owner-scope',
      createdAt: '2026-08-21T00:00:00.000Z',
      updatedAt: '2026-08-21T00:00:00.000Z',
      rows: [
        {
          id: 'row-1',
          selected: true,
          localSource: { fileName: 'A - B.mp3', mimeType: 'audio/mpeg', sizeBytes: 123 },
          localSourceAvailable: true,
          metadata: {
            artist: 'A',
            title: 'B',
            album: '',
            releaseDate: '',
            genres: [],
            tags: [],
          },
          manualFields: [],
          provenance: {
            artist: 'filename',
            title: 'filename',
            album: 'none',
            releaseDate: 'none',
            genres: 'none',
            tags: 'none',
          },
          durationMs: 120000,
          durationSource: 'embedded',
          cover: {
            origin: 'embedded',
            fileName: 'c.jpg',
            mimeType: 'image/jpeg',
            sizeBytes: 10,
            previewUrl: 'blob:legacy',
          },
          extraction: { status: 'complete' },
          publication: {
            source: 'acquired',
            audio: 'published',
            cover: 'unknown',
            metadata: 'published',
          },
        },
      ],
    };

    const restored = deserializeBulkImportBatch(JSON.stringify(legacy), 'admin', 'owner-scope');

    expect(restored?.schemaVersion).toBe(2);
    expect(restored?.rows[0].sourceGeneration).toBe(0);
    expect(restored?.rows[0].audioSourceAvailable).toBe(false);
    expect(restored?.rows[0].coverSourceAvailable).toBe(false);
    expect(restored?.rows[0].cover?.previewUrl).toBeNull();
    expect(restored?.rows[0].publication.source.status).toBe('not-started');
    expect(restored?.rows[0].publication.cover.status).toBe('not-started');
    expect(restored?.rows[0].publication.audio.status).toBe('not-started');
  });

  it('never migrates bare v1 published audio as trusted published state', () => {
    const restored = deserializeBulkImportBatch(
      JSON.stringify(
        makeLegacyBatch({
          source: 'not-started',
          audio: 'published',
          cover: 'not-started',
          metadata: 'not-started',
        }),
      ),
      'admin',
      'owner-scope',
    );

    expect(restored?.rows[0].publication.audio.status).toBe('not-started');
    expect(getBulkImportPublicationStatus(restored!.rows[0])).not.toBe('complete');
  });

  it('never migrates bare v1 published metadata as trusted published state', () => {
    const restored = deserializeBulkImportBatch(
      JSON.stringify(
        makeLegacyBatch({
          source: 'not-started',
          audio: 'not-started',
          cover: 'not-started',
          metadata: 'published',
        }),
      ),
      'admin',
      'owner-scope',
    );

    expect(restored?.rows[0].publication.metadata.status).toBe('not-started');
    expect(getBulkImportPublicationStatus(restored!.rows[0])).not.toBe('complete');
  });

  it('never migrates bare v1 published cover as trusted published state', () => {
    const restored = deserializeBulkImportBatch(
      JSON.stringify(
        makeLegacyBatch({
          source: 'not-started',
          audio: 'not-started',
          cover: 'published',
          metadata: 'not-started',
        }),
      ),
      'admin',
      'owner-scope',
    );

    expect(restored?.rows[0].publication.cover.status).toBe('not-started');
    expect(getBulkImportPublicationStatus(restored!.rows[0])).not.toBe('complete');
  });

  it('keeps legacy mixed published/failed/unknown from producing evidence-free completion', () => {
    const restored = deserializeBulkImportBatch(
      JSON.stringify(
        makeLegacyBatch({
          source: 'unknown',
          audio: 'published',
          cover: 'failed',
          metadata: 'unknown',
        }),
      ),
      'admin',
      'owner-scope',
    );

    expect(restored?.rows[0].publication.audio.status).toBe('not-started');
    expect(restored?.rows[0].publication.cover.status).toBe('failed');
    expect(restored?.rows[0].publication.metadata.status).toBe('not-started');
    expect(getBulkImportPublicationStatus(restored!.rows[0])).not.toBe('complete');
  });

  it('rejects a malformed legacy v1 batch rather than manufacturing completion', () => {
    const restored = deserializeBulkImportBatch(
      JSON.stringify(
        makeLegacyBatch({
          source: 'not-started',
          audio: 'not-a-status',
          cover: 'not-started',
          metadata: 'not-started',
        }),
      ),
      'admin',
      'owner-scope',
    );

    expect(restored).toBeNull();
  });

  it('downgrades invalid published v2 combinations instead of trusting them', () => {
    const batch = makeBatchWithCover();
    const serialized = serializeBulkImportBatch(batch);
    const parsed = JSON.parse(serialized) as {
      rows: Array<{
        publication: {
          audio: Record<string, unknown>;
          cover: Record<string, unknown>;
          metadata: Record<string, unknown>;
          source: Record<string, unknown>;
        };
      }>;
    };

    parsed.rows[0].publication.audio = {
      status: 'published',
      intent: { kind: 'audio', service: 'AUDIO', name: 'Owner', identifier: 'audio-id' },
      confirmed: null,
      contentRevision: null,
      attempt: null,
      transactionSignature: null,
      confirmedAt: null,
      updatedAt: null,
    };

    const restored = deserializeBulkImportBatch(JSON.stringify(parsed), 'admin', 'owner-scope');
    expect(restored?.rows[0].publication.audio.status).toBe('not-started');
    expect(getBulkImportPublicationStatus(restored!.rows[0])).not.toBe('complete');
  });

  it('rejects a published record that also contains an active error', () => {
    const step = {
      ...completePublishedStep('audio'),
      error: { code: 'ACTIVE_ERROR', message: 'must not be trusted', retryable: false },
    };
    const restored = mutateSerializedStep('audio', step);

    expect(restored?.rows[0].publication.audio.status).toBe('not-started');
    expect(getBulkImportPublicationStatus(restored!.rows[0])).not.toBe('complete');
  });

  it('rejects published audio stored under the metadata journal key', () => {
    const restored = mutateSerializedStep('metadata', completePublishedStep('audio'));

    expect(restored?.rows[0].publication.metadata.status).toBe('not-started');
    expect(getBulkImportPublicationStatus(restored!.rows[0])).not.toBe('complete');
  });

  it('rejects published metadata stored under the cover journal key', () => {
    const restored = mutateSerializedStep('cover', completePublishedStep('metadata'));

    expect(restored?.rows[0].publication.cover.status).toBe('not-started');
    expect(getBulkImportPublicationStatus(restored!.rows[0])).not.toBe('complete');
  });

  it('rejects a published record with no confirmed reference, attempt, or timestamp', () => {
    const withoutReference = { ...completePublishedStep('audio'), confirmed: null };
    const withoutAttempt = { ...completePublishedStep('audio'), attempt: null };
    const withoutTimestamp = { ...completePublishedStep('audio'), confirmedAt: null };

    expect(mutateSerializedStep('audio', withoutReference)?.rows[0].publication.audio.status).toBe(
      'not-started',
    );
    expect(mutateSerializedStep('audio', withoutAttempt)?.rows[0].publication.audio.status).toBe(
      'not-started',
    );
    expect(mutateSerializedStep('audio', withoutTimestamp)?.rows[0].publication.audio.status).toBe(
      'not-started',
    );
  });

  it('does not treat a published record with a mismatched current revision as complete', () => {
    const restored = mutateSerializedStep('audio', completePublishedStep('audio'));

    expect(restored?.rows[0].publication.audio.status).toBe('published');
    expect(getBulkImportPublicationStatus(restored!.rows[0])).not.toBe('complete');
  });

  it('downgrades durable unknown state missing intended revision or generation', () => {
    const missingRevision = {
      status: 'unknown',
      intent: { kind: 'cover', service: 'IMAGE', name: 'Owner', identifier: 'cover-id' },
      attempt: { attemptId: 'attempt-cover', startedAt: null, finishedAt: null },
      sourceGeneration: 0,
      reference: null,
      updatedAt: null,
    };
    const missingGeneration = {
      ...missingRevision,
      contentRevision: 'revision-cover',
      sourceGeneration: null,
    };

    expect(mutateSerializedStep('cover', missingRevision)?.rows[0].publication.cover.status).toBe(
      'not-started',
    );
    expect(mutateSerializedStep('cover', missingGeneration)?.rows[0].publication.cover.status).toBe(
      'not-started',
    );
  });

  it('does not trust a malformed discriminated variant as complete', () => {
    const restored = mutateSerializedStep('audio', {
      status: 'published',
      intent: { kind: 'audio', service: 'AUDIO', name: 'Owner', identifier: 'audio-id' },
      confirmed: { service: 'AUDIO', name: 'Owner', identifier: 'audio-id' },
      contentRevision: 'revision-current',
      attempt: { attemptId: 'attempt-id', startedAt: null, finishedAt: null },
      transactionSignature: null,
      confirmedAt: '2026-08-21T00:00:00.000Z',
      error: { code: '', message: '', retryable: false },
    });

    expect(restored?.rows[0].publication.audio.status).not.toBe('complete');
    expect(getBulkImportPublicationStatus(restored!.rows[0])).not.toBe('complete');
  });

  it('does not let a generation-only source change retain durable audio completion', () => {
    const batch = makeBatchWithCover();
    const row = batch.rows[0];
    row.publication.audio = createPublishedPublicationStep({
      intent: { kind: 'audio', service: 'AUDIO', name: 'Owner', identifier: 'audio-id' },
      confirmed: { service: 'AUDIO', name: 'Owner', identifier: 'audio-id' },
      contentRevision: computeAudioContentRevision(row.localSource, row.sourceGeneration) ?? '',
      attemptId: 'attempt-audio',
      confirmedAt: '2026-08-21T00:00:00.000Z',
    });

    const parsed = JSON.parse(serializeBulkImportBatch(batch)) as {
      rows: Array<{ sourceGeneration: number }>;
    };
    parsed.rows[0].sourceGeneration += 1;

    const restored = deserializeBulkImportBatch(JSON.stringify(parsed), 'admin', 'owner-scope');

    expect(restored?.rows[0].publication.audio.status).toBe('published');
    expect(getBulkImportPublicationStatus(restored!.rows[0])).not.toBe('complete');
  });

  it('loads and saves through sessionStorage', () => {
    const batch = makeBatchWithCover();
    expect(saveBulkImportBatch(batch)).toBe(true);

    const restored = loadBulkImportBatch('admin', 'owner-scope');
    expect(restored?.id).toBe('batch-1');
    expect(restored?.rows).toHaveLength(1);

    clearBulkImportBatch('admin', 'owner-scope');
    expect(loadBulkImportBatch('admin', 'owner-scope')).toBeNull();
  });
});
