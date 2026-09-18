import { describe, expect, it, vi } from 'vitest';
import {
  createHome2BulkPublicationAdapter,
  Home2AndroidSequentialAcquisitionRequiredError,
  Home2ReconciliationRequiredError,
  type Home2BulkPublicationAdapter,
} from './home2BulkPublicationAdapter';
import { createBulkImportBatch, createBulkImportRow } from './batchStore';
import {
  computeAudioContentRevision,
  computeCoverContentRevision,
  computeMetadataContentRevision,
} from './contentRevision';
import {
  applyBulkPublicationRowResultToBatch,
  applyBulkPublicationSourceAcquisitionToBatch,
} from './home2PublicationReducer';
import {
  createEmptyPublicationJournal,
  createPublishedPublicationStep,
  createUnknownPublicationStep,
} from './publicationJournal';
import { serializeBulkImportBatch } from './services/bulkImportStorage';
import type { BulkImportBatch, BulkImportRow } from './types';
import type { BulkPublicationIntent, BulkPublicationRowIntent } from './publicationAdapter';

function rowIntent(
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
      title: 'Title',
      album: '',
      releaseDate: '',
      genres: [],
      tags: [],
    },
    durationMs: 120000,
    cover: {
      origin: 'manual',
      fileName: `${rowId}.jpg`,
      mimeType: 'image/jpeg',
      sizeBytes: 50,
    },
    publication: createEmptyPublicationJournal(),
    ...overrides,
  };
}

function intent(
  rows: BulkPublicationRowIntent[],
  role: 'admin' | 'listener' = 'admin',
): BulkPublicationIntent {
  return {
    batchId: 'batch-1',
    role,
    scope: 'scope',
    actor: { name: 'Owner', address: 'Q-owner' },
    rows,
  };
}

function domainRow(
  rowId: string,
  withCover = true,
  overrides: Partial<BulkImportRow> = {},
): BulkImportRow {
  const row = createBulkImportRow({
    id: rowId,
    fileName: `${rowId}.mp3`,
    mimeType: 'audio/mpeg',
    sizeBytes: 100,
  });
  row.durationMs = 120000;
  if (withCover) {
    row.cover = {
      origin: 'manual',
      fileName: `${rowId}.jpg`,
      mimeType: 'image/jpeg',
      sizeBytes: 50,
      previewUrl: null,
    };
    row.coverSourceAvailable = true;
  }
  return { ...row, ...overrides };
}

function publishedStep(row: BulkImportRow, kind: 'audio' | 'cover', identifier: string) {
  const revision =
    kind === 'audio'
      ? computeAudioContentRevision(row.localSource, row.sourceGeneration)
      : computeCoverContentRevision(row.cover);
  if (!revision) throw new Error('missing revision');

  return createPublishedPublicationStep({
    intent: { kind, service: kind === 'audio' ? 'AUDIO' : 'IMAGE', name: 'Owner', identifier },
    confirmed: { service: kind === 'audio' ? 'AUDIO' : 'IMAGE', name: 'Owner', identifier },
    contentRevision: revision,
    attemptId: `${kind}-sig`,
    confirmedAt: '2026-08-22T00:00:00.000Z',
    transactionSignature: `${kind}-sig`,
  });
}

function rowWithPublishedAudio(rowId: string, withCover = true): BulkPublicationRowIntent {
  const domain = domainRow(rowId, withCover);
  const journal = createEmptyPublicationJournal();
  journal.audio = publishedStep(domain, 'audio', `nodefm-audio-${rowId}`);
  if (withCover) {
    journal.cover = publishedStep(domain, 'cover', `nodefm-cover-${rowId}`);
  }
  return rowIntent(rowId, {
    publication: journal,
    cover: withCover
      ? {
          origin: 'manual',
          fileName: `${rowId}.jpg`,
          mimeType: 'image/jpeg',
          sizeBytes: 50,
        }
      : null,
  });
}

function rowWithAudioPublishedCoverPending(rowId: string): BulkPublicationRowIntent {
  const domain = domainRow(rowId, true);
  const journal = createEmptyPublicationJournal();
  journal.audio = publishedStep(domain, 'audio', `nodefm-audio-${rowId}`);
  return rowIntent(rowId, {
    publication: journal,
    cover: {
      origin: 'manual',
      fileName: `${rowId}.jpg`,
      mimeType: 'image/jpeg',
      sizeBytes: 50,
    },
  });
}

async function adapterWithCapability(
  platform: 'desktop' | 'android' = 'desktop',
): Promise<{ adapter: Home2BulkPublicationAdapter; transport: ReturnType<typeof vi.fn> }> {
  const transport = vi.fn(async (request: Record<string, unknown>) => {
    if (request.action === 'SHOW_ACTIONS') {
      return ['SELECT_QDN_PUBLISH_SOURCE', 'PUBLISH_QDN_RESOURCE'];
    }
    if (request.action === 'GET_HOST_INFO') {
      return { hostName: 'qortium-home', platform, route: { revision: 'r' } };
    }
    throw new Error(`Unexpected ${String(request.action)}`);
  });
  const adapter = createHome2BulkPublicationAdapter({
    transport,
    writeAccountGate: async () => ({ address: 'QTestAccount', isUnlocked: true }),
  });
  await adapter.detectCapability();
  return { adapter, transport: transport as unknown as ReturnType<typeof vi.fn> };
}

function selectedFile(fileName: string, size: number, mimeType: string | null = 'image/jpeg') {
  return {
    canceled: false,
    fileName,
    kind: 'file',
    mimeType,
    size,
    sourceToken: '11111111-1111-4111-8111-111111111111',
  };
}

function publishedResult(service: string, identifier: string, fileName: string, size: number) {
  return {
    accepted: true,
    resource: { service, name: 'Owner', identifier },
    source: { fileName, size },
    transactionSignature: `${service.toLowerCase()}-signature`,
  };
}

describe('Home 2 IMAGE cover publication', () => {
  it('acquires a matching native cover and never exposes the token', async () => {
    const { adapter, transport } = await adapterWithCapability();
    transport.mockImplementation(async (request: Record<string, unknown>) => {
      if (request.action === 'SHOW_ACTIONS')
        return ['SELECT_QDN_PUBLISH_SOURCE', 'PUBLISH_QDN_RESOURCE'];
      if (request.action === 'GET_HOST_INFO')
        return { hostName: 'qortium-home', platform: 'desktop', route: { revision: 'r' } };
      if (request.action === 'SELECT_QDN_PUBLISH_SOURCE') return selectedFile('row-1.jpg', 50);
      throw new Error('unexpected');
    });

    const result = await adapter.acquireCoverSource(intent([rowIntent('row-1')]), 'row-1');
    expect(result.canceled).toBe(false);
    expect(result.sources[0]).toMatchObject({ fileName: 'row-1.jpg', sizeBytes: 50 });
    expect(JSON.stringify(result.sources[0])).not.toContain('sourceToken');
  });

  it('rejects a wrong cover file and preserves retryability', async () => {
    const { adapter, transport } = await adapterWithCapability();
    transport.mockImplementation(async (request: Record<string, unknown>) => {
      if (request.action === 'SHOW_ACTIONS')
        return ['SELECT_QDN_PUBLISH_SOURCE', 'PUBLISH_QDN_RESOURCE'];
      if (request.action === 'GET_HOST_INFO')
        return { hostName: 'qortium-home', platform: 'desktop', route: { revision: 'r' } };
      if (request.action === 'SELECT_QDN_PUBLISH_SOURCE') return selectedFile('wrong.jpg', 99);
      throw new Error('unexpected');
    });

    const result = await adapter.acquireCoverSource(intent([rowIntent('row-1')]), 'row-1');
    expect(result.sources).toEqual([]);
    expect(result.failedRows[0]).toMatchObject({
      error: { code: 'SOURCE_MISMATCH', retryable: false },
    });
  });

  it('treats no cover as not required', async () => {
    const { adapter, transport } = await adapterWithCapability();
    transport.mockImplementation(async (request: Record<string, unknown>) => {
      if (request.action === 'SHOW_ACTIONS')
        return ['SELECT_QDN_PUBLISH_SOURCE', 'PUBLISH_QDN_RESOURCE'];
      if (request.action === 'GET_HOST_INFO')
        return { hostName: 'qortium-home', platform: 'desktop', route: { revision: 'r' } };
      if (request.action === 'SELECT_QDN_PUBLISH_SOURCE')
        return selectedFile('nodefm-track-row-1.json', 123, 'application/json');
      throw new Error('unexpected');
    });

    const result = await adapter.acquireCoverSource(
      intent([rowIntent('row-1', { cover: null })]),
      'row-1',
    );
    expect(result.sources).toEqual([]);
    expect(result.failedRows[0]).toMatchObject({ error: { code: 'COVER_NOT_REQUIRED' } });
  });

  it('publishes an accepted IMAGE result and advances the cover journal', async () => {
    const { adapter, transport } = await adapterWithCapability();
    transport.mockImplementation(async (request: Record<string, unknown>) => {
      if (request.action === 'SHOW_ACTIONS')
        return ['SELECT_QDN_PUBLISH_SOURCE', 'PUBLISH_QDN_RESOURCE'];
      if (request.action === 'GET_HOST_INFO')
        return { hostName: 'qortium-home', platform: 'desktop', route: { revision: 'r' } };
      if (request.action === 'SELECT_QDN_PUBLISH_SOURCE') return selectedFile('row-1.jpg', 50);
      if (request.action === 'PUBLISH_QDN_RESOURCE') {
        expect(request.service).toBe('IMAGE');
        expect(request).not.toHaveProperty('data64');
        expect(request).not.toHaveProperty('base64');
        return publishedResult('IMAGE', request.identifier as string, 'row-1.jpg', 50);
      }
      throw new Error('unexpected');
    });

    const rowValue = rowWithAudioPublishedCoverPending('row-1');
    const acquisition = await adapter.acquireCoverSource(intent([rowValue]), 'row-1');
    const result = await adapter.publishCover(intent([rowValue]), acquisition.sources[0]);
    expect(result.status).toBe('partial');
    expect(result.steps[0]).toMatchObject({ status: 'published', step: 'cover' });

    const batch = {
      ...createBulkImportBatch('admin', 'scope', { id: 'batch-1' }),
      rows: [domainRow('row-1')],
    };
    const applied = applyBulkPublicationRowResultToBatch(batch, result);
    expect(applied.rows[0].publication.cover.status).toBe('published');
  });

  it('maps signed-unknown IMAGE without blind retry', async () => {
    const { adapter, transport } = await adapterWithCapability();
    transport.mockImplementation(async (request: Record<string, unknown>) => {
      if (request.action === 'SHOW_ACTIONS')
        return ['SELECT_QDN_PUBLISH_SOURCE', 'PUBLISH_QDN_RESOURCE'];
      if (request.action === 'GET_HOST_INFO')
        return { hostName: 'qortium-home', platform: 'desktop', route: { revision: 'r' } };
      if (request.action === 'SELECT_QDN_PUBLISH_SOURCE') return selectedFile('row-1.jpg', 50);
      if (request.action === 'PUBLISH_QDN_RESOURCE') {
        return {
          accepted: false,
          outcome: 'unknown',
          errorType: 'BROADCAST_UNKNOWN',
          retryable: false,
          resource: { service: 'IMAGE', name: 'Owner', identifier: request.identifier as string },
          source: { fileName: 'row-1.jpg', size: 50 },
          transactionSignature: 'unknown-cover',
        };
      }
      throw new Error('unexpected');
    });

    const rowValue = rowWithAudioPublishedCoverPending('row-1');
    const acquisition = await adapter.acquireCoverSource(intent([rowValue]), 'row-1');
    const result = await adapter.publishCover(intent([rowValue]), acquisition.sources[0]);
    expect(result.status).toBe('unknown');

    const row = domainRow('row-1');
    const pendingRow = rowWithAudioPublishedCoverPending('row-1');
    const journal = pendingRow.publication;
    journal.cover = createUnknownPublicationStep({
      intent: { kind: 'cover', service: 'IMAGE', name: 'Owner', identifier: 'nodefm-cover-row-1' },
      attemptId: 'unknown-cover',
      contentRevision: computeCoverContentRevision(row.cover) ?? '',
      sourceGeneration: 0,
    });
    const nextRow = {
      ...pendingRow,
      publication: journal,
    };
    const nextIntent = intent([nextRow]);
    const retryAcquisition = await adapter.acquireCoverSource(nextIntent, 'row-1');
    await expect(adapter.publishCover(nextIntent, retryAcquisition.sources[0])).rejects.toThrow(
      Home2ReconciliationRequiredError,
    );
  });

  it('rejects a cover that changed after native acquisition', async () => {
    const { adapter, transport } = await adapterWithCapability();
    transport.mockImplementation(async (request: Record<string, unknown>) => {
      if (request.action === 'SHOW_ACTIONS')
        return ['SELECT_QDN_PUBLISH_SOURCE', 'PUBLISH_QDN_RESOURCE'];
      if (request.action === 'GET_HOST_INFO')
        return { hostName: 'qortium-home', platform: 'desktop', route: { revision: 'r' } };
      if (request.action === 'SELECT_QDN_PUBLISH_SOURCE') return selectedFile('row-1.jpg', 50);
      throw new Error('unexpected');
    });

    const originalRow = rowWithAudioPublishedCoverPending('row-1');
    const acquisition = await adapter.acquireCoverSource(intent([originalRow]), 'row-1');
    const changedRow = rowIntent('row-1', {
      publication: originalRow.publication,
      cover: {
        origin: 'manual',
        fileName: 'row-1.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 51,
      },
    });

    const result = await adapter.publishCover(intent([changedRow]), acquisition.sources[0]);
    expect(result.status).toBe('failed');
    expect(result.steps[0]).toMatchObject({ error: { code: 'SOURCE_STALE' } });
    expect(transport).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PUBLISH_QDN_RESOURCE' }),
    );
  });
});

describe('Home 2 JSON metadata publication', () => {
  it('acquires an exported metadata JSON only when filename and size match', async () => {
    const { adapter, transport } = await adapterWithCapability();
    transport.mockImplementation(async (request: Record<string, unknown>) => {
      if (request.action === 'SHOW_ACTIONS')
        return ['SELECT_QDN_PUBLISH_SOURCE', 'PUBLISH_QDN_RESOURCE'];
      if (request.action === 'GET_HOST_INFO')
        return { hostName: 'qortium-home', platform: 'desktop', route: { revision: 'r' } };
      if (request.action === 'SELECT_QDN_PUBLISH_SOURCE')
        return selectedFile('nodefm-track-row-1.json', 123, 'application/json');
      throw new Error('unexpected');
    });

    const result = await adapter.acquireMetadataSource(
      intent([rowWithPublishedAudio('row-1')]),
      'row-1',
      { fileName: 'nodefm-track-row-1.json', mimeType: 'application/json', sizeBytes: 123 },
    );
    expect(result.sources[0]).toMatchObject({
      fileName: 'nodefm-track-row-1.json',
      sizeBytes: 123,
    });
  });

  it('rejects filename and size mismatches for metadata', async () => {
    const { adapter, transport } = await adapterWithCapability();
    transport.mockImplementation(async (request: Record<string, unknown>) => {
      if (request.action === 'SHOW_ACTIONS')
        return ['SELECT_QDN_PUBLISH_SOURCE', 'PUBLISH_QDN_RESOURCE'];
      if (request.action === 'GET_HOST_INFO')
        return { hostName: 'qortium-home', platform: 'desktop', route: { revision: 'r' } };
      if (request.action === 'SELECT_QDN_PUBLISH_SOURCE')
        return selectedFile('wrong.json', 999, 'application/json');
      throw new Error('unexpected');
    });

    const result = await adapter.acquireMetadataSource(
      intent([rowWithPublishedAudio('row-1')]),
      'row-1',
      { fileName: 'nodefm-track-row-1.json', mimeType: 'application/json', sizeBytes: 123 },
    );
    expect(result.failedRows[0]).toMatchObject({ error: { code: 'SOURCE_MISMATCH' } });
  });

  it('publishes accepted JSON metadata and advances the metadata journal', async () => {
    const { adapter, transport } = await adapterWithCapability();
    transport.mockImplementation(async (request: Record<string, unknown>) => {
      if (request.action === 'SHOW_ACTIONS')
        return ['SELECT_QDN_PUBLISH_SOURCE', 'PUBLISH_QDN_RESOURCE'];
      if (request.action === 'GET_HOST_INFO')
        return { hostName: 'qortium-home', platform: 'desktop', route: { revision: 'r' } };
      if (request.action === 'SELECT_QDN_PUBLISH_SOURCE')
        return selectedFile('nodefm-track-row-1.json', 123, 'application/json');
      if (request.action === 'PUBLISH_QDN_RESOURCE') {
        expect(request.service).toBe('JSON');
        expect(request).not.toHaveProperty('data64');
        expect(request).not.toHaveProperty('json');
        return publishedResult('JSON', 'nodefm-track-row-1', 'nodefm-track-row-1.json', 123);
      }
      throw new Error('unexpected');
    });

    const rowIntentValue = rowWithPublishedAudio('row-1');
    const acquisition = await adapter.acquireMetadataSource(intent([rowIntentValue]), 'row-1', {
      fileName: 'nodefm-track-row-1.json',
      mimeType: 'application/json',
      sizeBytes: 123,
    });
    const result = await adapter.publishMetadata(intent([rowIntentValue]), acquisition.sources[0], {
      fileName: 'nodefm-track-row-1.json',
      mimeType: 'application/json',
      sizeBytes: 123,
    });
    expect(result.status).toBe('complete');
    expect(result.steps[0]).toMatchObject({ status: 'published', step: 'metadata' });

    const batch: BulkImportBatch = {
      ...createBulkImportBatch('admin', 'scope', { id: 'batch-1' }),
      rows: [domainRow('row-1')],
    };
    batch.rows[0].metadata = rowIntentValue.metadata;
    batch.rows[0].publication.audio = publishedStep(batch.rows[0], 'audio', 'nodefm-audio-row-1');
    batch.rows[0].publication.cover = publishedStep(batch.rows[0], 'cover', 'nodefm-cover-row-1');
    const applied = applyBulkPublicationRowResultToBatch(batch, result);
    expect(applied.rows[0].publication.metadata.status).toBe('published');
  });

  it('requires AUDIO before metadata publication', async () => {
    const { adapter, transport } = await adapterWithCapability();
    transport.mockImplementation(async (request: Record<string, unknown>) => {
      if (request.action === 'SHOW_ACTIONS')
        return ['SELECT_QDN_PUBLISH_SOURCE', 'PUBLISH_QDN_RESOURCE'];
      if (request.action === 'GET_HOST_INFO')
        return { hostName: 'qortium-home', platform: 'desktop', route: { revision: 'r' } };
      if (request.action === 'SELECT_QDN_PUBLISH_SOURCE')
        return selectedFile('nodefm-track-row-1.json', 123, 'application/json');
      throw new Error('unexpected');
    });

    const acquisition = await adapter.acquireMetadataSource(
      intent([rowIntent('row-1', { cover: null })]),
      'row-1',
      { fileName: 'nodefm-track-row-1.json', mimeType: 'application/json', sizeBytes: 123 },
    );
    const result = await adapter.publishMetadata(
      intent([rowIntent('row-1', { cover: null })]),
      acquisition.sources[0],
      { fileName: 'nodefm-track-row-1.json', mimeType: 'application/json', sizeBytes: 123 },
    );
    expect(result.status).toBe('failed');
    expect(result.steps[0]).toMatchObject({
      status: 'failed',
      error: { code: 'AUDIO_DEPENDENCY_NOT_READY' },
    });
  });

  it('requires COVER before metadata publication when a cover exists', async () => {
    const { adapter, transport } = await adapterWithCapability();
    transport.mockImplementation(async (request: Record<string, unknown>) => {
      if (request.action === 'SHOW_ACTIONS')
        return ['SELECT_QDN_PUBLISH_SOURCE', 'PUBLISH_QDN_RESOURCE'];
      if (request.action === 'GET_HOST_INFO')
        return { hostName: 'qortium-home', platform: 'desktop', route: { revision: 'r' } };
      if (request.action === 'SELECT_QDN_PUBLISH_SOURCE')
        return selectedFile('nodefm-track-row-1.json', 123, 'application/json');
      throw new Error('unexpected');
    });

    const domain = domainRow('row-1', true);
    const journal = createEmptyPublicationJournal();
    journal.audio = publishedStep(domain, 'audio', 'nodefm-audio-row-1');
    const rowValue = rowIntent('row-1', { publication: journal });
    const acquisition = await adapter.acquireMetadataSource(intent([rowValue]), 'row-1', {
      fileName: 'nodefm-track-row-1.json',
      mimeType: 'application/json',
      sizeBytes: 123,
    });
    const result = await adapter.publishMetadata(intent([rowValue]), acquisition.sources[0], {
      fileName: 'nodefm-track-row-1.json',
      mimeType: 'application/json',
      sizeBytes: 123,
    });
    expect(result.status).toBe('failed');
    expect(result.steps[0]).toMatchObject({
      status: 'failed',
      error: { code: 'COVER_DEPENDENCY_NOT_READY' },
    });
  });

  it('blocks blind retry of an unknown JSON metadata outcome', async () => {
    const { adapter, transport } = await adapterWithCapability();
    transport.mockImplementation(async (request: Record<string, unknown>) => {
      if (request.action === 'SHOW_ACTIONS')
        return ['SELECT_QDN_PUBLISH_SOURCE', 'PUBLISH_QDN_RESOURCE'];
      if (request.action === 'GET_HOST_INFO')
        return { hostName: 'qortium-home', platform: 'desktop', route: { revision: 'r' } };
      if (request.action === 'SELECT_QDN_PUBLISH_SOURCE')
        return selectedFile('nodefm-track-row-1.json', 123, 'application/json');
      throw new Error('unexpected');
    });

    const pendingRow = rowWithPublishedAudio('row-1');
    const journal = pendingRow.publication;
    journal.metadata = createUnknownPublicationStep({
      intent: {
        kind: 'metadata',
        service: 'JSON',
        name: 'Owner',
        identifier: 'nodefm-track-row-1',
      },
      attemptId: 'unknown-metadata',
      contentRevision: computeMetadataContentRevision(pendingRow.metadata),
      sourceGeneration: 0,
    });
    const nextIntent = intent([{ ...pendingRow, publication: journal }]);
    const acquisition = await adapter.acquireMetadataSource(nextIntent, 'row-1', {
      fileName: 'nodefm-track-row-1.json',
      mimeType: 'application/json',
      sizeBytes: 123,
    });

    await expect(
      adapter.publishMetadata(nextIntent, acquisition.sources[0], {
        fileName: 'nodefm-track-row-1.json',
        mimeType: 'application/json',
        sizeBytes: 123,
      }),
    ).rejects.toThrow(Home2ReconciliationRequiredError);
    expect(transport).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PUBLISH_QDN_RESOURCE' }),
    );
  });
});

describe('Android strict one-source sequencing', () => {
  it('does not pre-acquire a second source across AUDIO, IMAGE, and JSON', async () => {
    const { adapter, transport } = await adapterWithCapability('android');
    transport.mockImplementation(async (request: Record<string, unknown>) => {
      if (request.action === 'SHOW_ACTIONS')
        return ['SELECT_QDN_PUBLISH_SOURCE', 'PUBLISH_QDN_RESOURCE'];
      if (request.action === 'GET_HOST_INFO')
        return { hostName: 'qortium-home', platform: 'android', route: { revision: 'r' } };
      if (request.action === 'SELECT_QDN_PUBLISH_SOURCE')
        return selectedFile('row-1.mp3', 100, 'audio/mpeg');
      throw new Error('unexpected');
    });

    await adapter.acquireRowSource(intent([rowIntent('row-1')]), 'row-1');
    await expect(adapter.acquireCoverSource(intent([rowIntent('row-1')]), 'row-1')).rejects.toThrow(
      Home2AndroidSequentialAcquisitionRequiredError,
    );
  });
});

describe('boundary invariants', () => {
  it('never serializes a raw cover or metadata token', async () => {
    const { adapter, transport } = await adapterWithCapability();
    transport.mockImplementation(async (request: Record<string, unknown>) => {
      if (request.action === 'SHOW_ACTIONS')
        return ['SELECT_QDN_PUBLISH_SOURCE', 'PUBLISH_QDN_RESOURCE'];
      if (request.action === 'GET_HOST_INFO')
        return { hostName: 'qortium-home', platform: 'desktop', route: { revision: 'r' } };
      if (request.action === 'SELECT_QDN_PUBLISH_SOURCE') return selectedFile('row-1.jpg', 50);
      if (request.action === 'PUBLISH_QDN_RESOURCE')
        return publishedResult('IMAGE', 'nodefm-cover-row-1', 'row-1.jpg', 50);
      throw new Error('unexpected');
    });

    const acquisition = await adapter.acquireCoverSource(intent([rowIntent('row-1')]), 'row-1');
    const publication = await adapter.publishCover(
      intent([rowIntent('row-1')]),
      acquisition.sources[0],
    );
    const batch = {
      ...createBulkImportBatch('admin', 'scope', { id: 'batch-1' }),
      rows: [domainRow('row-1')],
    };
    const applied = applyBulkPublicationSourceAcquisitionToBatch(batch, acquisition.sources[0]);
    const serialized = serializeBulkImportBatch(
      applyBulkPublicationRowResultToBatch(applied, publication),
    );
    expect(serialized).not.toContain('sourceToken');
    expect(serialized).not.toContain('11111111-1111-4111-8111-111111111111');
  });

  it('never serializes a raw metadata source token', async () => {
    const { adapter, transport } = await adapterWithCapability();
    transport.mockImplementation(async (request: Record<string, unknown>) => {
      if (request.action === 'SHOW_ACTIONS')
        return ['SELECT_QDN_PUBLISH_SOURCE', 'PUBLISH_QDN_RESOURCE'];
      if (request.action === 'GET_HOST_INFO')
        return { hostName: 'qortium-home', platform: 'desktop', route: { revision: 'r' } };
      if (request.action === 'SELECT_QDN_PUBLISH_SOURCE')
        return selectedFile('nodefm-track-row-1.json', 123, 'application/json');
      if (request.action === 'PUBLISH_QDN_RESOURCE')
        return publishedResult('JSON', 'nodefm-track-row-1', 'nodefm-track-row-1.json', 123);
      throw new Error('unexpected');
    });

    const rowValue = rowWithPublishedAudio('row-1');
    const acquisition = await adapter.acquireMetadataSource(intent([rowValue]), 'row-1', {
      fileName: 'nodefm-track-row-1.json',
      mimeType: 'application/json',
      sizeBytes: 123,
    });
    const publication = await adapter.publishMetadata(intent([rowValue]), acquisition.sources[0], {
      fileName: 'nodefm-track-row-1.json',
      mimeType: 'application/json',
      sizeBytes: 123,
    });

    const batch: BulkImportBatch = {
      ...createBulkImportBatch('admin', 'scope', { id: 'batch-1' }),
      rows: [domainRow('row-1')],
    };
    batch.rows[0].metadata = rowValue.metadata;
    batch.rows[0].publication.audio = publishedStep(batch.rows[0], 'audio', 'nodefm-audio-row-1');
    batch.rows[0].publication.cover = publishedStep(batch.rows[0], 'cover', 'nodefm-cover-row-1');
    const serialized = serializeBulkImportBatch(
      applyBulkPublicationRowResultToBatch(batch, publication),
    );
    expect(serialized).not.toContain('sourceToken');
    expect(serialized).not.toContain('11111111-1111-4111-8111-111111111111');
  });
});
