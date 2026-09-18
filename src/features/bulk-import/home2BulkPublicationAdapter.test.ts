import { describe, expect, it, vi } from 'vitest';
import {
  createHome2BulkPublicationAdapter,
  Home2AndroidSequentialAcquisitionRequiredError,
  Home2ReconciliationRequiredError,
  type Home2BridgeTransport,
  type Home2BulkPublicationAdapter,
} from './home2BulkPublicationAdapter';
import {
  applyBulkPublicationRowResultToBatch,
  applyBulkPublicationSourceAcquisitionToBatch,
} from './home2PublicationReducer';
import { createBulkImportBatch, createBulkImportRow } from './batchStore';
import {
  createEmptyPublicationJournal,
  createPublishedPublicationStep,
  createUnknownPublicationStep,
} from './publicationJournal';
import { computeAudioContentRevision } from './contentRevision';
import { serializeBulkImportBatch } from './services/bulkImportStorage';
import { TEST_WRITE_ACCOUNT } from '../../__tests__/support/writeGateBridge';
import type { BulkImportBatch, BulkImportRow } from './types';
import type {
  BulkPublicationIntent,
  BulkPublicationRowIntent,
  BulkPublicationRowResult,
} from './publicationAdapter';

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
      title: 'Title',
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

function makeIntent(rows: BulkPublicationRowIntent[]): BulkPublicationIntent {
  return {
    batchId: 'batch-1',
    role: 'admin',
    scope: 'owner-scope',
    actor: { name: 'Owner', address: 'Q-owner' },
    rows,
  };
}

function makeBatch(rows: BulkImportRow[] = []): BulkImportBatch {
  return {
    ...createBulkImportBatch('admin', 'owner-scope', { id: 'batch-1' }),
    rows,
  };
}

function makeDomainRow(rowId: string, overrides: Partial<BulkImportRow> = {}): BulkImportRow {
  return {
    ...createBulkImportRow({
      id: rowId,
      fileName: `${rowId}.mp3`,
      mimeType: 'audio/mpeg',
      sizeBytes: 100,
    }),
    durationMs: 120000,
    durationSource: 'embedded',
    ...overrides,
  };
}

function showActionsTransport(
  actions: string[],
  platform: 'desktop' | 'android',
): Home2BridgeTransport {
  return vi.fn(async (request: Record<string, unknown>) => {
    if (request.action === 'SHOW_ACTIONS') return actions;
    if (request.action === 'GET_HOST_INFO') {
      return { hostName: 'qortium-home', platform, route: { revision: 'route-1' } };
    }
    throw new Error(`Unexpected request ${String(request.action)}.`);
  });
}

async function adapterWithCapability(
  actions: string[] = ['SELECT_QDN_PUBLISH_SOURCE', 'PUBLISH_QDN_RESOURCE'],
  platform: 'desktop' | 'android' = 'desktop',
): Promise<{
  adapter: Home2BulkPublicationAdapter;
  transport: ReturnType<typeof vi.fn>;
}> {
  const transport = vi.fn(showActionsTransport(actions, platform)) as unknown as ReturnType<
    typeof vi.fn
  >;
  const adapter = createHome2BulkPublicationAdapter({
    transport: transport as unknown as Home2BridgeTransport,
    writeAccountGate: unlockedAccountGate,
  });
  await adapter.detectCapability();
  return { adapter, transport };
}

/** Bulk publication is a signed write; adapter tests run it with an unlocked account. */
const unlockedAccountGate = async (): Promise<unknown> => ({ ...TEST_WRITE_ACCOUNT });

function acceptedPublishResult(identifier: string, fileName: string, size: number) {
  return {
    accepted: true,
    resource: { service: 'AUDIO', name: 'Owner', identifier },
    source: { fileName, size },
    transactionSignature: 'signature-1',
    immutable: {
      algorithm: 'SHA-256',
      contentHash: 'hash',
      transactionSignature: 'signature-1',
    },
  };
}

function unknownPublishResult(identifier: string, fileName: string, size: number) {
  return {
    accepted: false,
    outcome: 'unknown',
    errorType: 'BROADCAST_UNKNOWN',
    retryable: false,
    resource: { service: 'AUDIO', name: 'Owner', identifier },
    source: { fileName, size },
    transactionSignature: 'signature-unknown',
  };
}

describe('Home 2 capability detection', () => {
  it('reports available when both required actions are advertised', async () => {
    const { adapter, transport } = await adapterWithCapability();
    expect(adapter.capability()).toMatchObject({ status: 'available' });
    expect(adapter.getHostPlatform()).toBe('desktop');
    expect(transport).toHaveBeenCalledWith({ action: 'SHOW_ACTIONS' });
    expect(transport).toHaveBeenCalledWith({ action: 'GET_HOST_INFO' });
  });

  it('reports unavailable when SELECT_QDN_PUBLISH_SOURCE is missing', async () => {
    const { adapter } = await adapterWithCapability(['PUBLISH_QDN_RESOURCE']);
    expect(adapter.capability()).toMatchObject({
      status: 'unavailable',
      reason: 'requires-home-2-capability',
    });
    expect(adapter.capability().message).toContain('SELECT_QDN_PUBLISH_SOURCE');
  });

  it('reports unavailable when PUBLISH_QDN_RESOURCE is missing', async () => {
    const { adapter } = await adapterWithCapability(['SELECT_QDN_PUBLISH_SOURCE']);
    expect(adapter.capability()).toMatchObject({ status: 'unavailable' });
    expect(adapter.capability().message).toContain('PUBLISH_QDN_RESOURCE');
  });

  it('reports unavailable when SHOW_ACTIONS cannot be read', async () => {
    const transport = vi.fn(async () => {
      throw new Error('bridge missing');
    });
    const adapter = createHome2BulkPublicationAdapter({ transport });
    await adapter.detectCapability();

    expect(adapter.capability()).toMatchObject({ status: 'unavailable' });
  });
});

describe('Home 2 native source acquisition', () => {
  it('acquires a row-bound logical handle and normalizes null MIME', async () => {
    const { adapter, transport } = await adapterWithCapability();
    transport.mockImplementation(async (request: Record<string, unknown>) => {
      if (request.action === 'SHOW_ACTIONS') {
        return ['SELECT_QDN_PUBLISH_SOURCE', 'PUBLISH_QDN_RESOURCE'];
      }
      if (request.action === 'GET_HOST_INFO') {
        return { hostName: 'qortium-home', platform: 'desktop', route: { revision: 'r' } };
      }
      if (request.action === 'SELECT_QDN_PUBLISH_SOURCE') {
        return {
          canceled: false,
          fileName: 'row-1.mp3',
          kind: 'file',
          mimeType: null,
          size: 100,
          sourceToken: '11111111-1111-4111-8111-111111111111',
        };
      }
      throw new Error('unexpected');
    });

    const result = await adapter.acquireRowSource(makeIntent([makeRowIntent('row-1')]), 'row-1');
    expect(result.canceled).toBe(false);
    expect(result.sources[0]).toMatchObject({
      rowId: 'row-1',
      sourceGeneration: 0,
      fileName: 'row-1.mp3',
      mimeType: '',
      sizeBytes: 100,
      available: true,
    });
    expect(result.sources[0].handleId).not.toBe('11111111-1111-4111-8111-111111111111');
    expect(JSON.stringify(result.sources[0])).not.toContain('sourceToken');
  });

  it('treats picker cancellation as a safe no-op', async () => {
    const { adapter, transport } = await adapterWithCapability();
    transport.mockImplementation(async (request: Record<string, unknown>) => {
      if (request.action === 'SELECT_QDN_PUBLISH_SOURCE') return { canceled: true };
      if (request.action === 'GET_HOST_INFO') {
        return { hostName: 'qortium-home', platform: 'desktop', route: { revision: 'r' } };
      }
      if (request.action === 'SHOW_ACTIONS') {
        return ['SELECT_QDN_PUBLISH_SOURCE', 'PUBLISH_QDN_RESOURCE'];
      }
      throw new Error('unexpected');
    });

    const result = await adapter.acquireRowSource(makeIntent([makeRowIntent('row-1')]), 'row-1');
    expect(result.canceled).toBe(true);
    expect(result.sources).toEqual([]);
    expect(result.failedRows).toEqual([]);
  });

  it('rejects a native file that does not match the staged row', async () => {
    const { adapter, transport } = await adapterWithCapability();
    transport.mockImplementation(async (request: Record<string, unknown>) => {
      if (request.action === 'SELECT_QDN_PUBLISH_SOURCE') {
        return {
          canceled: false,
          fileName: 'other.mp3',
          kind: 'file',
          mimeType: 'audio/mpeg',
          size: 999,
          sourceToken: '11111111-1111-4111-8111-111111111111',
        };
      }
      if (request.action === 'GET_HOST_INFO') {
        return { hostName: 'qortium-home', platform: 'desktop', route: { revision: 'r' } };
      }
      if (request.action === 'SHOW_ACTIONS') {
        return ['SELECT_QDN_PUBLISH_SOURCE', 'PUBLISH_QDN_RESOURCE'];
      }
      throw new Error('unexpected');
    });

    const result = await adapter.acquireRowSource(makeIntent([makeRowIntent('row-1')]), 'row-1');
    expect(result.sources).toEqual([]);
    expect(result.failedRows[0]).toMatchObject({
      rowId: 'row-1',
      error: { code: 'SOURCE_MISMATCH', retryable: false },
    });
  });

  it('classifies a malformed/expired native descriptor safely', async () => {
    const { adapter, transport } = await adapterWithCapability();
    transport.mockImplementation(async (request: Record<string, unknown>) => {
      if (request.action === 'SELECT_QDN_PUBLISH_SOURCE') {
        throw Object.assign(new Error('Selected publish source expired. Select the file again.'), {
          code: 'SOURCE_EXPIRED',
          retryable: false,
        });
      }
      if (request.action === 'GET_HOST_INFO') {
        return { hostName: 'qortium-home', platform: 'desktop', route: { revision: 'r' } };
      }
      if (request.action === 'SHOW_ACTIONS') {
        return ['SELECT_QDN_PUBLISH_SOURCE', 'PUBLISH_QDN_RESOURCE'];
      }
      throw new Error('unexpected');
    });

    const result = await adapter.acquireRowSource(makeIntent([makeRowIntent('row-1')]), 'row-1');
    expect(result.sources).toEqual([]);
    expect(result.failedRows[0]).toMatchObject({
      rowId: 'row-1',
      error: { code: 'SOURCE_EXPIRED', retryable: false },
    });
  });

  it('holds independent desktop handles for multiple rows', async () => {
    const tokens = new Map([
      ['row-1', '11111111-1111-4111-8111-111111111111'],
      ['row-2', '22222222-2222-4222-8222-222222222222'],
    ]);
    const { adapter, transport } = await adapterWithCapability();
    transport.mockImplementation(async (request: Record<string, unknown>) => {
      if (request.action === 'SHOW_ACTIONS') {
        return ['SELECT_QDN_PUBLISH_SOURCE', 'PUBLISH_QDN_RESOURCE'];
      }
      if (request.action === 'GET_HOST_INFO') {
        return { hostName: 'qortium-home', platform: 'desktop', route: { revision: 'r' } };
      }
      if (request.action === 'SELECT_QDN_PUBLISH_SOURCE') return { canceled: true };
      throw new Error('unexpected');
    });

    const intent = makeIntent([makeRowIntent('row-1'), makeRowIntent('row-2')]);
    await adapter.acquireRowSource(intent, 'row-1');
    await adapter.acquireRowSource(intent, 'row-2');

    expect(tokens.size).toBe(2);
    expect(transport).toHaveBeenCalledWith({ action: 'SELECT_QDN_PUBLISH_SOURCE', kind: 'file' });
  });
});

describe('Home 2 AUDIO publication', () => {
  it('maps an accepted result and advances only after validator passes', async () => {
    const { adapter, transport } = await adapterWithCapability();
    transport.mockImplementation(async (request: Record<string, unknown>) => {
      if (request.action === 'SELECT_QDN_PUBLISH_SOURCE') {
        return {
          canceled: false,
          fileName: 'row-1.mp3',
          kind: 'file',
          mimeType: 'audio/mpeg',
          size: 100,
          sourceToken: '11111111-1111-4111-8111-111111111111',
        };
      }
      if (request.action === 'PUBLISH_QDN_RESOURCE') {
        expect(request).toEqual({
          action: 'PUBLISH_QDN_RESOURCE',
          sourceToken: '11111111-1111-4111-8111-111111111111',
          service: 'AUDIO',
          name: 'Owner',
          identifier: expect.stringMatching(/^nodefm-audio-/),
        });
        expect(request).not.toHaveProperty('data64');
        expect(request).not.toHaveProperty('base64');
        expect(request).not.toHaveProperty('file');
        expect(request).not.toHaveProperty('path');
        return acceptedPublishResult(request.identifier as string, 'row-1.mp3', 100);
      }
      if (request.action === 'GET_HOST_INFO') {
        return { hostName: 'qortium-home', platform: 'desktop', route: { revision: 'r' } };
      }
      if (request.action === 'SHOW_ACTIONS') {
        return ['SELECT_QDN_PUBLISH_SOURCE', 'PUBLISH_QDN_RESOURCE'];
      }
      throw new Error('unexpected');
    });

    const intent = makeIntent([makeRowIntent('row-1')]);
    const acquisition = await adapter.acquireRowSource(intent, 'row-1');
    const result = await adapter.publishRow(intent, acquisition.sources[0]);

    expect(result.status).toBe('partial');
    expect(result.steps[0]).toMatchObject({
      status: 'published',
      step: 'audio',
      attemptId: 'signature-1',
      transactionSignature: 'signature-1',
    });

    const batch = makeBatch([makeDomainRow('row-1')]);
    const next = applyBulkPublicationRowResultToBatch(batch, result);
    expect(next.rows[0].publication.audio).toMatchObject({
      status: 'published',
      intent: { kind: 'audio', service: 'AUDIO', name: 'Owner' },
      confirmed: {
        service: 'AUDIO',
        name: 'Owner',
        identifier: expect.stringMatching(/^nodefm-audio-/),
      },
      transactionSignature: 'signature-1',
    });
  });

  it('runs the shared account-write gate first and publishes nothing when it refuses', async () => {
    const gate = vi.fn(async (): Promise<unknown> => {
      throw new Error('The selected account is locked.');
    });
    const transport = vi.fn(async (request: Record<string, unknown>) => {
      if (request.action === 'SHOW_ACTIONS') {
        return ['SELECT_QDN_PUBLISH_SOURCE', 'PUBLISH_QDN_RESOURCE'];
      }
      if (request.action === 'GET_HOST_INFO') {
        return { hostName: 'qortium-home', platform: 'desktop', route: { revision: 'r' } };
      }
      if (request.action === 'SELECT_QDN_PUBLISH_SOURCE') {
        return {
          canceled: false,
          fileName: 'row-1.mp3',
          kind: 'file',
          mimeType: 'audio/mpeg',
          size: 100,
          sourceToken: '11111111-1111-4111-8111-111111111111',
        };
      }
      if (request.action === 'PUBLISH_QDN_RESOURCE') {
        throw new Error('A refused gate must publish nothing.');
      }
      throw new Error('unexpected');
    });
    const adapter = createHome2BulkPublicationAdapter({
      transport,
      writeAccountGate: gate,
    });
    await adapter.detectCapability();

    const intent = makeIntent([makeRowIntent('row-1')]);
    const acquisition = await adapter.acquireRowSource(intent, 'row-1');
    const result = await adapter.publishRow(intent, acquisition.sources[0]);

    expect(gate).toHaveBeenCalledWith('PUBLISH_QDN_RESOURCE');
    expect(transport).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PUBLISH_QDN_RESOURCE' }),
    );
    expect(result.status).toBe('failed');
    expect(result.steps[0]).toMatchObject({
      status: 'failed',
      step: 'audio',
      error: { code: 'PUBLICATION_FAILED', message: 'The selected account is locked.' },
    });
  });

  it('maps a signed-unknown result with the Home signature as attempt identity', async () => {
    const { adapter, transport } = await adapterWithCapability();
    transport.mockImplementation(async (request: Record<string, unknown>) => {
      if (request.action === 'SELECT_QDN_PUBLISH_SOURCE') {
        return {
          canceled: false,
          fileName: 'row-1.mp3',
          kind: 'file',
          mimeType: 'audio/mpeg',
          size: 100,
          sourceToken: '11111111-1111-4111-8111-111111111111',
        };
      }
      if (request.action === 'PUBLISH_QDN_RESOURCE') {
        return unknownPublishResult(request.identifier as string, 'row-1.mp3', 100);
      }
      if (request.action === 'GET_HOST_INFO') {
        return { hostName: 'qortium-home', platform: 'desktop', route: { revision: 'r' } };
      }
      if (request.action === 'SHOW_ACTIONS') {
        return ['SELECT_QDN_PUBLISH_SOURCE', 'PUBLISH_QDN_RESOURCE'];
      }
      throw new Error('unexpected');
    });

    const intent = makeIntent([makeRowIntent('row-1')]);
    const acquisition = await adapter.acquireRowSource(intent, 'row-1');
    const result = await adapter.publishRow(intent, acquisition.sources[0]);

    expect(result.status).toBe('unknown');
    expect(result.steps[0]).toMatchObject({
      status: 'unknown',
      attemptId: 'signature-unknown',
    });

    const batch = makeBatch([makeDomainRow('row-1')]);
    const next = applyBulkPublicationRowResultToBatch(batch, result);
    expect(next.rows[0].publication.audio.status).toBe('unknown');
    expect(
      (
        next.rows[0].publication.audio as {
          status: 'unknown';
          attempt: { attemptId: string };
        }
      ).attempt.attemptId,
    ).toBe('signature-unknown');
    expect(serializeBulkImportBatch(next)).not.toContain('sourceToken');
  });

  it('maps confirmed pre-sign failure without retaining a consumed handle claim', async () => {
    const { adapter, transport } = await adapterWithCapability();
    transport.mockImplementation(async (request: Record<string, unknown>) => {
      if (request.action === 'SELECT_QDN_PUBLISH_SOURCE') {
        return {
          canceled: false,
          fileName: 'row-1.mp3',
          kind: 'file',
          mimeType: 'audio/mpeg',
          size: 100,
          sourceToken: '11111111-1111-4111-8111-111111111111',
        };
      }
      if (request.action === 'PUBLISH_QDN_RESOURCE') {
        throw Object.assign(new Error('Account access was denied.'), {
          code: 'PUBLICATION_DENIED',
          retryable: false,
        });
      }
      if (request.action === 'GET_HOST_INFO') {
        return { hostName: 'qortium-home', platform: 'desktop', route: { revision: 'r' } };
      }
      if (request.action === 'SHOW_ACTIONS') {
        return ['SELECT_QDN_PUBLISH_SOURCE', 'PUBLISH_QDN_RESOURCE'];
      }
      throw new Error('unexpected');
    });

    const intent = makeIntent([makeRowIntent('row-1')]);
    const acquisition = await adapter.acquireRowSource(intent, 'row-1');
    const result = await adapter.publishRow(intent, acquisition.sources[0]);

    expect(result.status).toBe('failed');
    expect(result.steps[0]).toMatchObject({
      status: 'failed',
      error: { code: 'PUBLICATION_DENIED', retryable: false },
    });
  });

  it('rejects a stale or wrong-bound handle', async () => {
    const { adapter, transport } = await adapterWithCapability();
    transport.mockImplementation(async (request: Record<string, unknown>) => {
      if (request.action === 'SELECT_QDN_PUBLISH_SOURCE') {
        return {
          canceled: false,
          fileName: 'row-1.mp3',
          kind: 'file',
          mimeType: 'audio/mpeg',
          size: 100,
          sourceToken: '11111111-1111-4111-8111-111111111111',
        };
      }
      if (request.action === 'GET_HOST_INFO') {
        return { hostName: 'qortium-home', platform: 'desktop', route: { revision: 'r' } };
      }
      if (request.action === 'SHOW_ACTIONS') {
        return ['SELECT_QDN_PUBLISH_SOURCE', 'PUBLISH_QDN_RESOURCE'];
      }
      throw new Error('unexpected');
    });
    const intent = makeIntent([makeRowIntent('row-1')]);
    const acquisition = await adapter.acquireRowSource(intent, 'row-1');

    await expect(
      adapter.publishRow(intent, { ...acquisition.sources[0], handleId: 'wrong' }),
    ).rejects.toThrow(/Stale native source handle/);

    await expect(
      adapter.publishRow({ ...intent, batchId: 'batch-2' }, acquisition.sources[0]),
    ).rejects.toThrow(/No active native source handle/);
  });

  it('skips already-confirmed audio without a bridge publish', async () => {
    const row = makeDomainRow('row-1');
    const revision = computeAudioContentRevision(row.localSource, row.sourceGeneration) ?? '';
    const published = createPublishedPublicationStep({
      intent: { kind: 'audio', service: 'AUDIO', name: 'Owner', identifier: 'nodefm-audio-1' },
      confirmed: { service: 'AUDIO', name: 'Owner', identifier: 'nodefm-audio-1' },
      contentRevision: revision,
      attemptId: 'signature-1',
      confirmedAt: '2026-08-21T00:00:00.000Z',
      transactionSignature: 'signature-1',
    });
    const journal = createEmptyPublicationJournal();
    journal.audio = published;
    const intent = makeIntent([makeRowIntent('row-1', { publication: journal })]);
    const { adapter, transport } = await adapterWithCapability();
    transport.mockImplementation(async (request: Record<string, unknown>) => {
      if (request.action === 'SELECT_QDN_PUBLISH_SOURCE') {
        return {
          canceled: false,
          fileName: 'row-1.mp3',
          kind: 'file',
          mimeType: 'audio/mpeg',
          size: 100,
          sourceToken: '11111111-1111-4111-8111-111111111111',
        };
      }
      if (request.action === 'GET_HOST_INFO') {
        return { hostName: 'qortium-home', platform: 'desktop', route: { revision: 'r' } };
      }
      if (request.action === 'SHOW_ACTIONS') {
        return ['SELECT_QDN_PUBLISH_SOURCE', 'PUBLISH_QDN_RESOURCE'];
      }
      throw new Error('unexpected');
    });

    const acquisition = await adapter.acquireRowSource(intent, 'row-1');
    const result = await adapter.publishRow(intent, acquisition.sources[0]);

    expect(result.status).toBe('no-op');
    expect(result.steps[0]).toMatchObject({ status: 'skipped', reason: 'already-confirmed' });
    expect(transport).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PUBLISH_QDN_RESOURCE' }),
    );
  });

  it('blocks blind retry of an unknown outcome', async () => {
    const row = makeDomainRow('row-1');
    const revision = computeAudioContentRevision(row.localSource, row.sourceGeneration) ?? '';
    const journal = createEmptyPublicationJournal();
    journal.audio = createUnknownPublicationStep({
      intent: { kind: 'audio', service: 'AUDIO', name: 'Owner', identifier: 'nodefm-audio-1' },
      attemptId: 'signature-unknown',
      contentRevision: revision,
      sourceGeneration: row.sourceGeneration,
    });
    const intent = makeIntent([makeRowIntent('row-1', { publication: journal })]);
    const { adapter, transport } = await adapterWithCapability();
    transport.mockImplementation(async (request: Record<string, unknown>) => {
      if (request.action === 'SELECT_QDN_PUBLISH_SOURCE') {
        return {
          canceled: false,
          fileName: 'row-1.mp3',
          kind: 'file',
          mimeType: 'audio/mpeg',
          size: 100,
          sourceToken: '11111111-1111-4111-8111-111111111111',
        };
      }
      if (request.action === 'GET_HOST_INFO') {
        return { hostName: 'qortium-home', platform: 'desktop', route: { revision: 'r' } };
      }
      if (request.action === 'SHOW_ACTIONS') {
        return ['SELECT_QDN_PUBLISH_SOURCE', 'PUBLISH_QDN_RESOURCE'];
      }
      throw new Error('unexpected');
    });

    const acquisition = await adapter.acquireRowSource(intent, 'row-1');
    await expect(adapter.publishRow(intent, acquisition.sources[0])).rejects.toThrow(
      Home2ReconciliationRequiredError,
    );
    expect(transport).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PUBLISH_QDN_RESOURCE' }),
    );
  });

  it('preserves successful row evidence when a later row fails', async () => {
    const { adapter, transport } = await adapterWithCapability();
    let selectCount = 0;
    transport.mockImplementation(async (request: Record<string, unknown>) => {
      if (request.action === 'SHOW_ACTIONS') {
        return ['SELECT_QDN_PUBLISH_SOURCE', 'PUBLISH_QDN_RESOURCE'];
      }
      if (request.action === 'GET_HOST_INFO') {
        return { hostName: 'qortium-home', platform: 'desktop', route: { revision: 'r' } };
      }
      if (request.action === 'SELECT_QDN_PUBLISH_SOURCE') {
        selectCount += 1;
        const rowId = selectCount === 1 ? 'row-1' : 'row-2';
        return {
          canceled: false,
          fileName: `${rowId}.mp3`,
          kind: 'file',
          mimeType: 'audio/mpeg',
          size: 100,
          sourceToken: `${selectCount}1111111-1111-4111-8111-111111111111`,
        };
      }
      if (request.action === 'PUBLISH_QDN_RESOURCE') {
        if (String(request.sourceToken).startsWith('1')) {
          return acceptedPublishResult(request.identifier as string, 'row-1.mp3', 100);
        }
        throw Object.assign(new Error('Public resource publication was denied.'), {
          code: 'PUBLICATION_DENIED',
          retryable: false,
        });
      }
      throw new Error('unexpected');
    });

    const intent = makeIntent([makeRowIntent('row-1'), makeRowIntent('row-2')]);
    const firstAcquisition = await adapter.acquireRowSource(intent, 'row-1');
    const secondAcquisition = await adapter.acquireRowSource(intent, 'row-2');
    const firstResult = await adapter.publishRow(intent, firstAcquisition.sources[0]);
    const secondResult = await adapter.publishRow(intent, secondAcquisition.sources[0]);

    let batch = makeBatch([makeDomainRow('row-1'), makeDomainRow('row-2')]);
    batch = applyBulkPublicationRowResultToBatch(batch, firstResult);
    batch = applyBulkPublicationRowResultToBatch(batch, secondResult);

    expect(batch.rows.find((candidate) => candidate.id === 'row-1')?.publication.audio.status).toBe(
      'published',
    );
    expect(batch.rows.find((candidate) => candidate.id === 'row-2')?.publication.audio.status).toBe(
      'failed',
    );
  });
});

describe('Android strict one-at-a-time flow', () => {
  it('rejects batch acquisition of more than one row', async () => {
    const { adapter } = await adapterWithCapability(
      ['SELECT_QDN_PUBLISH_SOURCE', 'PUBLISH_QDN_RESOURCE'],
      'android',
    );

    await expect(
      adapter.acquirePublicationSources(
        makeIntent([makeRowIntent('row-1'), makeRowIntent('row-2')]),
      ),
    ).rejects.toThrow(Home2AndroidSequentialAcquisitionRequiredError);
  });

  it('does not allow a second row acquisition before the first source is consumed', async () => {
    const { adapter, transport } = await adapterWithCapability(
      ['SELECT_QDN_PUBLISH_SOURCE', 'PUBLISH_QDN_RESOURCE'],
      'android',
    );
    transport.mockImplementation(async (request: Record<string, unknown>) => {
      if (request.action === 'SELECT_QDN_PUBLISH_SOURCE') {
        return {
          canceled: false,
          fileName: 'row-1.mp3',
          kind: 'file',
          mimeType: 'audio/mpeg',
          size: 100,
          sourceToken: '11111111-1111-4111-8111-111111111111',
        };
      }
      if (request.action === 'PUBLISH_QDN_RESOURCE') {
        return acceptedPublishResult(request.identifier as string, 'row-1.mp3', 100);
      }
      if (request.action === 'GET_HOST_INFO') {
        return { hostName: 'qortium-home', platform: 'android', route: { revision: 'r' } };
      }
      if (request.action === 'SHOW_ACTIONS') {
        return ['SELECT_QDN_PUBLISH_SOURCE', 'PUBLISH_QDN_RESOURCE'];
      }
      throw new Error('unexpected');
    });

    const intent = makeIntent([makeRowIntent('row-1'), makeRowIntent('row-2')]);
    await adapter.acquireRowSource(intent, 'row-1');

    await expect(adapter.acquireRowSource(intent, 'row-2')).rejects.toThrow(
      Home2AndroidSequentialAcquisitionRequiredError,
    );
  });
});

describe('Home 2 result reducer validation', () => {
  it('advances a current accepted adapter result', () => {
    const row = makeDomainRow('row-1');
    const revision = computeAudioContentRevision(row.localSource, row.sourceGeneration) ?? '';
    const rowResult: BulkPublicationRowResult = {
      batchId: 'batch-1',
      rowId: 'row-1',
      sourceGeneration: 0,
      status: 'partial',
      steps: [
        {
          status: 'published',
          batchId: 'batch-1',
          rowId: 'row-1',
          sourceGeneration: 0,
          step: 'audio',
          intent: { kind: 'audio', service: 'AUDIO', name: 'Owner', identifier: 'nodefm-audio-1' },
          contentRevision: revision,
          attemptId: 'signature-1',
          reference: { service: 'AUDIO', name: 'Owner', identifier: 'nodefm-audio-1' },
          confirmedContentRevision: revision,
          transactionSignature: 'signature-1',
          confirmedAt: '2026-08-21T00:00:00.000Z',
        },
      ],
    };

    const next = applyBulkPublicationRowResultToBatch(makeBatch([row]), rowResult);
    expect(next.rows[0].publication.audio.status).toBe('published');
  });

  it('refuses a stale-generation adapter result', () => {
    const row = makeDomainRow('row-1');
    const revision = computeAudioContentRevision(row.localSource, row.sourceGeneration) ?? '';
    const rowResult: BulkPublicationRowResult = {
      batchId: 'batch-1',
      rowId: 'row-1',
      sourceGeneration: 1,
      status: 'partial',
      steps: [
        {
          status: 'published',
          batchId: 'batch-1',
          rowId: 'row-1',
          sourceGeneration: 1,
          step: 'audio',
          intent: { kind: 'audio', service: 'AUDIO', name: 'Owner', identifier: 'nodefm-audio-1' },
          contentRevision: revision,
          attemptId: 'signature-1',
          reference: { service: 'AUDIO', name: 'Owner', identifier: 'nodefm-audio-1' },
          confirmedContentRevision: revision,
          transactionSignature: 'signature-1',
          confirmedAt: '2026-08-21T00:00:00.000Z',
        },
      ],
    };

    expect(() => applyBulkPublicationRowResultToBatch(makeBatch([row]), rowResult)).toThrow(
      /stale row/,
    );
  });
});

describe('adapter boundary invariants', () => {
  it('never serializes a raw Home token or native handle into durable state', async () => {
    const { adapter, transport } = await adapterWithCapability();
    transport.mockImplementation(async (request: Record<string, unknown>) => {
      if (request.action === 'SELECT_QDN_PUBLISH_SOURCE') {
        return {
          canceled: false,
          fileName: 'row-1.mp3',
          kind: 'file',
          mimeType: 'audio/mpeg',
          size: 100,
          sourceToken: '11111111-1111-4111-8111-111111111111',
        };
      }
      if (request.action === 'GET_HOST_INFO') {
        return { hostName: 'qortium-home', platform: 'desktop', route: { revision: 'r' } };
      }
      if (request.action === 'SHOW_ACTIONS') {
        return ['SELECT_QDN_PUBLISH_SOURCE', 'PUBLISH_QDN_RESOURCE'];
      }
      if (request.action === 'PUBLISH_QDN_RESOURCE') {
        return acceptedPublishResult(request.identifier as string, 'row-1.mp3', 100);
      }
      throw new Error('unexpected');
    });

    const intent = makeIntent([makeRowIntent('row-1')]);
    const acquisition = await adapter.acquireRowSource(intent, 'row-1');
    const publication = await adapter.publishRow(intent, acquisition.sources[0]);
    let batch = makeBatch([makeDomainRow('row-1')]);
    batch = applyBulkPublicationSourceAcquisitionToBatch(batch, acquisition.sources[0]);
    batch = applyBulkPublicationRowResultToBatch(batch, publication);

    const serialized = serializeBulkImportBatch(batch);
    expect(serialized).not.toContain('11111111-1111-4111-8111-111111111111');
    expect(serialized).not.toContain('sourceToken');
    expect(serialized).not.toContain('nativePath');
    expect(serialized).not.toContain('contentUri');
  });

  it('uses only single-resource Home 2 actions and no inline AUDIO bytes', async () => {
    const { adapter, transport } = await adapterWithCapability();
    transport.mockImplementation(async (request: Record<string, unknown>) => {
      if (request.action === 'SELECT_QDN_PUBLISH_SOURCE') {
        return {
          canceled: false,
          fileName: 'row-1.mp3',
          kind: 'file',
          mimeType: 'audio/mpeg',
          size: 100,
          sourceToken: '11111111-1111-4111-8111-111111111111',
        };
      }
      if (request.action === 'PUBLISH_QDN_RESOURCE') {
        return acceptedPublishResult(request.identifier as string, 'row-1.mp3', 100);
      }
      if (request.action === 'GET_HOST_INFO') {
        return { hostName: 'qortium-home', platform: 'desktop', route: { revision: 'r' } };
      }
      if (request.action === 'SHOW_ACTIONS') {
        return ['SELECT_QDN_PUBLISH_SOURCE', 'PUBLISH_QDN_RESOURCE'];
      }
      throw new Error('unexpected');
    });

    const intent = makeIntent([makeRowIntent('row-1')]);
    const acquisition = await adapter.acquireRowSource(intent, 'row-1');
    await adapter.publishRow(intent, acquisition.sources[0]);

    const actions = transport.mock.calls.map((call) => call[0].action);
    expect(actions).not.toContain('PUBLISH_MULTIPLE_QDN_RESOURCES');
    const publishCall = transport.mock.calls.find(
      (call) => call[0].action === 'PUBLISH_QDN_RESOURCE',
    )?.[0] as Record<string, unknown>;
    expect(publishCall).toBeDefined();
    expect(publishCall).not.toHaveProperty('data64');
    expect(publishCall).not.toHaveProperty('base64');
    expect(publishCall).not.toHaveProperty('bytes');
    expect(publishCall).not.toHaveProperty('file');
    expect(publishCall).not.toHaveProperty('path');
  });
});
