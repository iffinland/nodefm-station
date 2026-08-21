import { describe, expect, it } from 'vitest';
import {
  createBulkImportBatch,
  createBulkImportRow,
  setBulkImportMetadataField,
} from './batchStore';
import {
  computeAudioContentRevision,
  computeCoverContentRevision,
  computeMetadataContentRevision,
} from './contentRevision';
import {
  createEmptyPublicationJournal,
  createFailedPublicationStep,
  createPublishedPublicationStep,
  createUnknownPublicationStep,
} from './publicationJournal';
import {
  getBulkImportBatchSummary,
  getBulkImportPublicationStatus,
  getBulkImportRowValidation,
} from './selectors';
import type { BulkImportBatch, BulkImportPublicationJournal, BulkImportRow } from './types';

function makeRow(id: string, overrides: Partial<BulkImportRow> = {}): BulkImportRow {
  return {
    ...createBulkImportRow({
      id,
      fileName: `${id} - Track.mp3`,
      mimeType: 'audio/mpeg',
      sizeBytes: 1024,
    }),
    durationMs: 120000,
    durationSource: 'embedded',
    ...overrides,
  };
}

function makeBatch(rows: BulkImportRow[]): BulkImportBatch {
  return { ...createBulkImportBatch('admin', 'owner-scope'), rows };
}

function audioIntent() {
  return {
    kind: 'audio' as const,
    service: 'AUDIO',
    name: 'Owner',
    identifier: 'audio-id',
  };
}

function coverIntent() {
  return {
    kind: 'cover' as const,
    service: 'IMAGE',
    name: 'Owner',
    identifier: 'cover-id',
  };
}

function metadataIntent() {
  return {
    kind: 'metadata' as const,
    service: 'JSON',
    name: 'Owner',
    identifier: 'metadata-id',
  };
}

function makePublishedJournal(row: BulkImportRow): BulkImportPublicationJournal {
  const journal = createEmptyPublicationJournal();
  journal.source.status = 'acquired';
  journal.audio = createPublishedPublicationStep({
    intent: audioIntent(),
    confirmed: { service: 'AUDIO', name: 'Owner', identifier: 'audio-id' },
    contentRevision: computeAudioContentRevision(row.localSource, row.sourceGeneration) ?? '',
    attemptId: 'attempt-audio',
    confirmedAt: '2026-08-21T00:00:00.000Z',
  });
  journal.cover = row.cover
    ? createPublishedPublicationStep({
        intent: coverIntent(),
        confirmed: { service: 'IMAGE', name: 'Owner', identifier: 'cover-id' },
        contentRevision: computeCoverContentRevision(row.cover) ?? '',
        attemptId: 'attempt-cover',
        confirmedAt: '2026-08-21T00:00:00.000Z',
      })
    : createEmptyPublicationJournal().cover;
  journal.metadata = createPublishedPublicationStep({
    intent: metadataIntent(),
    confirmed: { service: 'JSON', name: 'Owner', identifier: 'metadata-id' },
    contentRevision: computeMetadataContentRevision(row.metadata),
    attemptId: 'attempt-metadata',
    confirmedAt: '2026-08-21T00:00:00.000Z',
  });
  return journal;
}

describe('bulk import validation selectors', () => {
  it('identifies invalid rows and missing required Artist/Title', () => {
    const row = makeRow('row-1');
    row.metadata.artist = '';
    row.metadata.title = '';

    expect(getBulkImportRowValidation(row).missingRequiredFields).toEqual(['artist', 'title']);
    expect(getBulkImportRowValidation(row).needsAttention).toBe(true);
  });

  it('does not block on optional fields or valid empty release date', () => {
    const row = makeRow('row-1');
    row.metadata.artist = 'Artist';
    row.metadata.title = 'Title';

    const validation = getBulkImportRowValidation(row);
    expect(validation.needsAttention).toBe(false);
  });

  it('blocks invalid release dates', () => {
    const row = makeRow('row-1');
    row.metadata.artist = 'Artist';
    row.metadata.title = 'Title';
    row.metadata.releaseDate = '2023-02-30';

    expect(getBulkImportRowValidation(row).hasInvalidReleaseDate).toBe(true);
    expect(getBulkImportRowValidation(row).needsAttention).toBe(true);
  });

  it('requires a positive duration before a row can be Ready', () => {
    const row = makeRow('row-1', { durationMs: null, durationSource: 'none' });
    const validation = getBulkImportRowValidation(row);

    expect(validation.durationMissing).toBe(true);
    expect(validation.needsAttention).toBe(true);
  });

  it('flags a cover intent whose transient source is unavailable', () => {
    const row = makeRow('row-1', {
      cover: {
        origin: 'manual',
        fileName: 'cover.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 10,
        previewUrl: null,
      },
      coverSourceAvailable: false,
    });

    expect(getBulkImportRowValidation(row).coverSourceMissing).toBe(true);
  });

  it('requires at least one selected row before publication', () => {
    const summary = getBulkImportBatchSummary(makeBatch([]));
    expect(summary.isPublicationReady).toBe(false);
    expect(summary.publicationBlockers).toContain('Select at least one track to publish.');
  });

  it('blocks only when selected rows are invalid', () => {
    const invalid = makeRow('invalid');
    invalid.metadata.title = '';

    const valid = makeRow('valid');
    valid.metadata.artist = 'Artist';
    valid.metadata.title = 'Title';
    valid.selected = true;
    invalid.selected = false;

    const summary = getBulkImportBatchSummary(makeBatch([invalid, valid]));
    expect(summary.isPublicationReady).toBe(true);
    expect(summary.publicationBlockers).toEqual([]);
  });

  it('blocks readiness when a selected row has no valid duration', () => {
    const summary = getBulkImportBatchSummary(
      makeBatch([makeRow('a', { durationMs: null, durationSource: 'none' })]),
    );

    expect(summary.isPublicationReady).toBe(false);
    expect(summary.publicationBlockers).toContain('1 selected track missing a valid duration.');
  });

  it('blocks readiness when a selected cover source must be resolved', () => {
    const summary = getBulkImportBatchSummary(
      makeBatch([
        makeRow('a', {
          cover: {
            origin: 'embedded',
            fileName: 'c.jpg',
            mimeType: 'image/jpeg',
            sizeBytes: 1,
            previewUrl: null,
          },
          coverSourceAvailable: false,
        }),
      ]),
    );

    expect(summary.isPublicationReady).toBe(false);
    expect(summary.publicationBlockers).toContain(
      '1 selected track has a cover that needs re-selection or removal.',
    );
  });

  it('recomputes count and size in the batch summary', () => {
    let batch = makeBatch([makeRow('a'), makeRow('b')]);
    batch = setBulkImportMetadataField(batch, 'a', 'title', 'Fixed A');

    const summary = getBulkImportBatchSummary(batch);
    expect(summary.limits.selectedCount).toBe(2);
    expect(summary.limits.selectedBytes).toBe(2048);
  });
});

describe('bulk import publication journal status', () => {
  it('reports not-started when the journal is empty', () => {
    const row = makeRow('row-1', { publication: createEmptyPublicationJournal() });
    expect(getBulkImportPublicationStatus(row)).toBe('not-started');
  });

  it('requires current audio and metadata revisions before complete', () => {
    const row = makeRow('row-1');
    row.publication = makePublishedJournal(row);

    expect(getBulkImportPublicationStatus(row)).toBe('complete');
  });

  it('does not trust a published-shaped status without matching evidence', () => {
    const row = makeRow('row-1');
    row.publication = createEmptyPublicationJournal();
    row.publication.audio = createPublishedPublicationStep({
      intent: audioIntent(),
      confirmed: { service: 'AUDIO', name: 'Owner', identifier: 'audio-id' },
      contentRevision: computeAudioContentRevision(row.localSource, row.sourceGeneration) ?? '',
      attemptId: 'a',
      confirmedAt: '2026-08-21T00:00:00.000Z',
    });

    expect(getBulkImportPublicationStatus(row)).toBe('partial');
  });

  it('treats failed, unknown, and partial states distinctly', () => {
    const failed = makeRow('failed');
    failed.publication = makePublishedJournal(failed);
    failed.publication.audio = createFailedPublicationStep({
      error: { code: 'FAILED', message: 'failed', retryable: false },
    });
    expect(getBulkImportPublicationStatus(failed)).toBe('failed');

    const unknown = makeRow('unknown');
    unknown.publication = makePublishedJournal(unknown);
    unknown.publication.metadata = createUnknownPublicationStep({
      intent: metadataIntent(),
      attemptId: 'attempt-unknown',
      contentRevision: computeMetadataContentRevision(unknown.metadata),
      sourceGeneration: unknown.sourceGeneration,
    });
    expect(getBulkImportPublicationStatus(unknown)).toBe('unknown');

    const partial = makeRow('partial');
    partial.publication = createEmptyPublicationJournal();
    partial.publication.source.status = 'acquired';
    expect(getBulkImportPublicationStatus(partial)).toBe('partial');
  });

  it('invalidates a stale audio revision after source replacement', () => {
    const row = makeRow('row-1');
    row.publication = makePublishedJournal(row);
    row.localSource = {
      fileName: 'row-1 - Track.mp3',
      mimeType: 'audio/mpeg',
      sizeBytes: 9999,
    };

    expect(getBulkImportPublicationStatus(row)).toBe('partial');
  });

  it('invalidates audio completion when only the source generation changes', () => {
    const row = makeRow('row-1');
    row.publication = makePublishedJournal(row);
    row.sourceGeneration += 1;

    expect(getBulkImportPublicationStatus(row)).toBe('partial');
  });

  it('invalidates stale metadata evidence after an edit', () => {
    const row = makeRow('row-1');
    row.publication = makePublishedJournal(row);
    row.metadata.title = 'Edited Title';

    expect(getBulkImportPublicationStatus(row)).toBe('partial');
  });

  it('invalidates stale cover evidence after a cover change', () => {
    const row = makeRow('row-1', {
      cover: {
        origin: 'manual',
        fileName: 'old.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 10,
        previewUrl: null,
      },
    });
    row.publication = makePublishedJournal(row);
    row.cover = {
      origin: 'manual',
      fileName: 'new.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 20,
      previewUrl: null,
    };

    expect(getBulkImportPublicationStatus(row)).toBe('partial');
  });
});
