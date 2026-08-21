import { describe, expect, it } from 'vitest';
import {
  unavailableBulkPublicationAdapter,
  BulkPublicationUnavailableError,
} from './publicationAdapter';
import type { BulkPublicationIntent } from './publicationAdapter';
import { createEmptyPublicationJournal } from './publicationJournal';

const boundaryModules = import.meta.glob(
  [
    './publicationAdapter.ts',
    './publicationJournal.ts',
    './contentRevision.ts',
    './sourceIdentity.ts',
    './transientRegistry.ts',
    './batchStore.ts',
    './selectors.ts',
    './limits.ts',
    './filenameParser.ts',
    './metadataDraft.ts',
    './index.ts',
    './services/audioMetadata.ts',
    './services/localAudio.ts',
    './services/bulkImportStorage.ts',
    './components/BulkImportWorkspace.tsx',
    './components/BulkImportRowEditor.tsx',
    './components/BulkImportSummary.tsx',
  ],
  {
    query: '?raw',
    import: 'default',
    eager: true,
  },
);

const boundarySources = Object.values(boundaryModules) as string[];

function makeIntent(): BulkPublicationIntent {
  return {
    batchId: 'batch-1',
    role: 'admin',
    scope: 'owner-scope',
    actor: { name: 'Owner', address: 'Q-owner' },
    rows: [
      {
        rowId: 'row-1',
        sourceGeneration: 0,
        roleIntent: 'track',
        source: { fileName: 'A - B.mp3', mimeType: 'audio/mpeg', sizeBytes: 1 },
        metadata: {
          artist: 'A',
          title: 'B',
          album: '',
          releaseDate: '',
          genres: [],
          tags: [],
        },
        durationMs: 1000,
        cover: null,
        publication: createEmptyPublicationJournal(),
      },
    ],
  };
}

describe('bulk import publication boundary', () => {
  it('reports an honest unavailable capability and never fakes success', async () => {
    expect(unavailableBulkPublicationAdapter.capability()).toEqual({
      status: 'unavailable',
      reason: 'requires-home-2-capability',
      message: 'Bulk publication requires the upcoming Qortium Home capability.',
    });

    await expect(
      unavailableBulkPublicationAdapter.acquirePublicationSources(makeIntent()),
    ).rejects.toThrow(BulkPublicationUnavailableError);
    await expect(unavailableBulkPublicationAdapter.publishBatch(makeIntent(), [])).rejects.toThrow(
      /upcoming Qortium Home capability/i,
    );
    await expect(unavailableBulkPublicationAdapter.reconcileBatch(makeIntent())).rejects.toThrow(
      BulkPublicationUnavailableError,
    );
  });

  it('keeps the A1 production graph free of legacy Home/base64 transport', () => {
    expect(boundarySources.length).toBeGreaterThan(0);

    for (const source of boundarySources) {
      expect(source).not.toContain('PUBLISH_MULTIPLE_QDN_RESOURCES');
      expect(source).not.toContain('SELECT_QDN_PUBLISH_SOURCE');
      expect(source).not.toContain('publishMultipleResources');
      expect(source).not.toContain('sourceToken');
      expect(source).not.toContain('btoa(');
      expect(source).not.toContain('readAsDataURL');
      expect(source).not.toContain('data64');
    }
  });
});
