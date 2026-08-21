import { describe, expect, it } from 'vitest';
import {
  applyBulkImportExtraction,
  createBulkImportBatch,
  createBulkImportRow,
  markBulkImportRowAnalysisFailed,
  markBulkImportRowAnalyzing,
  removeBulkImportRow,
  setBulkImportMetadataField,
  setBulkImportRowCover,
  setBulkImportRowSelected,
  setBulkImportRowSource,
} from './batchStore';
import { createEmptyPublicationJournal } from './publicationJournal';
import { createPublishedPublicationStep } from './publicationJournal';
import type {
  AppliedBulkImportExtraction,
  BulkImportBatch,
  BulkImportPublicationJournal,
  BulkImportRow,
  EmbeddedAudioMetadata,
} from './types';

function makeBatch(role: 'admin' | 'listener' = 'admin'): BulkImportBatch {
  return createBulkImportBatch(role, `${role}-scope`, {
    id: 'batch-1',
    createdAt: '2026-08-21T00:00:00.000Z',
  });
}

function makeRow(id = 'row-1', fileName = 'Unknown - Track.mp3'): BulkImportRow {
  return createBulkImportRow({
    id,
    fileName,
    mimeType: 'audio/mpeg',
    sizeBytes: 100,
  });
}

function embedded(overrides: Partial<EmbeddedAudioMetadata> = {}): EmbeddedAudioMetadata {
  return {
    artist: 'Embedded Artist',
    title: 'Embedded Title',
    album: 'Embedded Album',
    releaseDate: '1999-12-31',
    genres: ['Electronic'],
    durationMs: 240000,
    picture: null,
    ...overrides,
  };
}

function extraction(
  metadata: EmbeddedAudioMetadata,
  durationSource: 'embedded' | 'local' = 'embedded',
): AppliedBulkImportExtraction {
  return {
    metadata,
    durationMs: metadata.durationMs,
    durationSource,
    coverPreviewUrl: null,
  };
}

function completedJournal(): BulkImportPublicationJournal {
  const journal = createEmptyPublicationJournal();
  journal.source.status = 'acquired';
  journal.audio = createPublishedPublicationStep({
    intent: { kind: 'audio', service: 'AUDIO', name: 'Owner', identifier: 'audio-id' },
    confirmed: { service: 'AUDIO', name: 'Owner', identifier: 'audio-id' },
    contentRevision: 'revision-audio',
    attemptId: 'attempt-audio',
    confirmedAt: '2026-08-21T00:00:00.000Z',
  });
  journal.cover = createPublishedPublicationStep({
    intent: { kind: 'cover', service: 'IMAGE', name: 'Owner', identifier: 'cover-id' },
    confirmed: { service: 'IMAGE', name: 'Owner', identifier: 'cover-id' },
    contentRevision: 'revision-cover',
    attemptId: 'attempt-cover',
    confirmedAt: '2026-08-21T00:00:00.000Z',
  });
  journal.metadata = createPublishedPublicationStep({
    intent: { kind: 'metadata', service: 'JSON', name: 'Owner', identifier: 'metadata-id' },
    confirmed: { service: 'JSON', name: 'Owner', identifier: 'metadata-id' },
    contentRevision: 'revision-metadata',
    attemptId: 'attempt-metadata',
    confirmedAt: '2026-08-21T00:00:00.000Z',
  });
  return journal;
}

describe('bulk import batch domain', () => {
  it('uses one role-neutral staging implementation for Admin and Listener', () => {
    const admin = makeBatch('admin');
    const listener = makeBatch('listener');

    expect(admin.role).toBe('admin');
    expect(listener.role).toBe('listener');
    expect(
      createBulkImportRow({ id: 'a', fileName: 'A - B.mp3', mimeType: 'audio/mpeg', sizeBytes: 1 }),
    ).toEqual(
      createBulkImportRow({ id: 'a', fileName: 'A - B.mp3', mimeType: 'audio/mpeg', sizeBytes: 1 }),
    );
  });

  it('applies filename fallback, then embedded metadata outranks it', () => {
    const row = makeRow('row-1', 'Filename Artist - Filename Title.mp3');
    const batch = { ...makeBatch(), rows: [row] };

    expect(row.metadata.artist).toBe('Filename Artist');
    expect(row.metadata.title).toBe('Filename Title');
    expect(row.provenance.artist).toBe('filename');

    const result = applyBulkImportExtraction(batch, 'row-1', extraction(embedded()));
    const updated = result.batch.rows[0];

    expect(updated.metadata.artist).toBe('Embedded Artist');
    expect(updated.metadata.title).toBe('Embedded Title');
    expect(updated.provenance.artist).toBe('embedded');
  });

  it('never overwrites manually edited fields during later analysis', () => {
    const row = makeRow('row-1', 'Filename Artist - Filename Title.mp3');
    let batch: BulkImportBatch = { ...makeBatch(), rows: [row] };
    batch = setBulkImportMetadataField(batch, 'row-1', 'title', 'Manual Title');
    batch = markBulkImportRowAnalyzing(batch, 'row-1');

    const result = applyBulkImportExtraction(batch, 'row-1', extraction(embedded()));
    const updated = result.batch.rows[0];

    expect(updated.metadata.title).toBe('Manual Title');
    expect(updated.provenance.title).toBe('manual');
    expect(updated.metadata.artist).toBe('Embedded Artist');
  });

  it('tracks row analysis state transitions without mutating the input batch', () => {
    const row = makeRow('row-1');
    const batch = { ...makeBatch(), rows: [row] };
    const originalRow = batch.rows[0];

    const analyzing = markBulkImportRowAnalyzing(batch, 'row-1');
    expect(analyzing.rows[0].extraction.status).toBe('running');
    expect(batch.rows[0].extraction.status).toBe('idle');
    expect(originalRow).toBe(batch.rows[0]);

    const failed = markBulkImportRowAnalysisFailed(analyzing, 'row-1', 'malformed');
    expect(failed.rows[0].extraction).toEqual({ status: 'failed', error: 'malformed' });
  });

  it('preserves a safe duration fallback alongside an extraction failure', () => {
    const row = makeRow('row-1');
    let batch: BulkImportBatch = { ...makeBatch(), rows: [row] };
    batch = markBulkImportRowAnalyzing(batch, 'row-1');
    batch = markBulkImportRowAnalysisFailed(batch, 'row-1', 'malformed tags', 120000);

    expect(batch.rows[0].extraction).toEqual({ status: 'failed', error: 'malformed tags' });
    expect(batch.rows[0].durationMs).toBe(120000);
    expect(batch.rows[0].durationSource).toBe('local');
  });

  it('removing and selecting rows immediately affects the row collection', () => {
    let batch: BulkImportBatch = {
      ...makeBatch(),
      rows: [makeRow('a'), makeRow('b')],
    };

    batch = setBulkImportRowSelected(batch, 'a', false);
    expect(batch.rows.find((row) => row.id === 'a')?.selected).toBe(false);

    batch = removeBulkImportRow(batch, 'a');
    expect(batch.rows.map((row) => row.id)).toEqual(['b']);
  });

  it('invalidates the metadata publication step when a metadata field changes', () => {
    const row: BulkImportRow = { ...makeRow('row-1'), publication: completedJournal() };
    const updated = setBulkImportMetadataField(
      { ...makeBatch(), rows: [row] },
      'row-1',
      'title',
      'New Title',
    );

    expect(updated.rows[0].publication.metadata.status).toBe('not-started');
    expect(updated.rows[0].publication.audio.status).toBe('published');
    expect(updated.rows[0].publication.cover.status).toBe('published');
  });

  it('invalidates cover and metadata steps when the cover changes', () => {
    const row: BulkImportRow = { ...makeRow('row-1'), publication: completedJournal() };
    const updated = setBulkImportRowCover({ ...makeBatch(), rows: [row] }, 'row-1', {
      origin: 'manual',
      fileName: 'new.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 123,
      previewUrl: 'blob:new',
    });

    expect(updated.rows[0].publication.cover.status).toBe('not-started');
    expect(updated.rows[0].publication.metadata.status).toBe('not-started');
    expect(updated.rows[0].publication.audio.status).toBe('published');
    expect(updated.rows[0].coverSourceAvailable).toBe(true);
  });

  it('invalidates source, audio, downstream metadata, and embedded cover on source change', () => {
    const row: BulkImportRow = {
      ...makeRow('row-1', 'Old Artist - Old Title.mp3'),
      cover: {
        origin: 'embedded',
        fileName: 'cover.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 10,
        previewUrl: 'blob:old-cover',
      },
      coverSourceAvailable: true,
      publication: completedJournal(),
    };

    const updated = setBulkImportRowSource({ ...makeBatch(), rows: [row] }, 'row-1', {
      fileName: 'New Artist - New Title.mp3',
      mimeType: 'audio/mpeg',
      sizeBytes: 200,
    }).rows[0];

    expect(updated.sourceGeneration).toBe(row.sourceGeneration + 1);
    expect(updated.metadata.artist).toBe('New Artist');
    expect(updated.metadata.title).toBe('New Title');
    expect(updated.cover).toBeNull();
    expect(updated.publication.source.status).toBe('not-started');
    expect(updated.publication.audio.status).toBe('not-started');
    expect(updated.publication.metadata.status).toBe('not-started');
  });

  it('preserves manual metadata and a manual cover during source replacement', () => {
    let batch: BulkImportBatch = {
      ...makeBatch(),
      rows: [makeRow('row-1', 'Old Artist - Old Title.mp3')],
    };
    batch = setBulkImportMetadataField(batch, 'row-1', 'artist', 'Manual Artist');
    batch = setBulkImportRowCover(batch, 'row-1', {
      origin: 'manual',
      fileName: 'manual.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 99,
      previewUrl: 'blob:manual',
    });

    const updated = setBulkImportRowSource(batch, 'row-1', {
      fileName: 'New - Song.mp3',
      mimeType: 'audio/mpeg',
      sizeBytes: 300,
    }).rows[0];

    expect(updated.metadata.artist).toBe('Manual Artist');
    expect(updated.metadata.title).toBe('Song');
    expect(updated.cover?.origin).toBe('manual');
    expect(updated.coverSourceAvailable).toBe(true);
  });
});
