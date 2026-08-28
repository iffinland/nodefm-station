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
  buildBulkImportMetadataDocument,
  createBulkImportMetadataArtifact,
  getBulkImportMetadataExportFilename,
  isBulkImportMetadataArtifactCurrent,
} from './metadataExport';
import {
  createEmptyPublicationJournal,
  createPublishedPublicationStep,
} from './publicationJournal';
import type { BulkImportBatch, BulkImportRow } from './types';

function rowWithCover(): BulkImportRow {
  const row = createBulkImportRow({
    id: 'row-1',
    fileName: 'Artist - Track.mp3',
    mimeType: 'audio/mpeg',
    sizeBytes: 1000,
  });
  row.metadata = {
    artist: 'Artist',
    title: 'Track',
    album: 'Album',
    releaseDate: '2024-05-01',
    genres: ['Rock'],
    tags: ['live'],
  };
  row.durationMs = 180000;
  row.cover = {
    origin: 'manual',
    fileName: 'cover.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 50,
    previewUrl: 'blob:cover',
  };
  row.coverSourceAvailable = true;
  return row;
}

function publishedStep(
  kind: 'audio' | 'cover' | 'metadata',
  row: BulkImportRow,
  reference: { service: string; name: string; identifier?: string },
) {
  const revision =
    kind === 'audio'
      ? computeAudioContentRevision(row.localSource, row.sourceGeneration)
      : kind === 'cover'
        ? computeCoverContentRevision(row.cover)
        : computeMetadataContentRevision(row.metadata);

  if (!revision) throw new Error('missing revision');

  return createPublishedPublicationStep({
    intent: {
      kind,
      service: kind === 'audio' ? 'AUDIO' : kind === 'cover' ? 'IMAGE' : 'JSON',
      name: 'Owner',
      identifier: reference.identifier ?? null,
    },
    confirmed: reference,
    contentRevision: revision,
    attemptId: `${kind}-signature`,
    confirmedAt: '2026-08-22T00:00:00.000Z',
    transactionSignature: `${kind}-signature`,
  });
}

function readyBatch(role: 'admin' | 'listener' = 'admin', withCover = true): BulkImportBatch {
  const batch = createBulkImportBatch(role, 'scope', {
    id: 'batch-1',
    createdAt: '2026-08-22T00:00:00.000Z',
  });
  const row = withCover
    ? rowWithCover()
    : createBulkImportRow({
        id: 'row-1',
        fileName: 'Artist - Track.mp3',
        mimeType: 'audio/mpeg',
        sizeBytes: 1000,
      });
  if (!withCover) {
    row.metadata = {
      artist: 'Artist',
      title: 'Track',
      album: '',
      releaseDate: '',
      genres: [],
      tags: [],
    };
    row.durationMs = 180000;
  }
  const journal = createEmptyPublicationJournal();
  journal.audio = publishedStep('audio', row, {
    service: 'AUDIO',
    name: 'Owner',
    identifier: 'nodefm-audio-1',
  });
  if (withCover) {
    journal.cover = publishedStep('cover', row, {
      service: 'IMAGE',
      name: 'Owner',
      identifier: 'nodefm-cover-1',
    });
  }
  row.publication = journal;
  batch.rows = [row];
  return batch;
}

describe('bulk import metadata export', () => {
  it('generates deterministic canonical Track JSON and a safe filename', () => {
    const batch = readyBatch();
    const row = batch.rows[0];

    const first = createBulkImportMetadataArtifact(batch, row, 'Owner', 'Q-owner');
    const second = createBulkImportMetadataArtifact(batch, row, 'Owner', 'Q-owner');

    expect(first.json).toBe(second.json);
    expect(first.fileName).toBe('nodefm-track-row-1.json');
    expect(first.sizeBytes).toBe(new TextEncoder().encode(first.json).byteLength);
    expect(JSON.parse(first.json)).toMatchObject({
      schemaVersion: 1,
      trackId: 'row-1',
      ownerAddress: 'Q-owner',
      title: 'Track',
      durationMs: 180000,
      audio: { service: 'AUDIO', name: 'Owner', identifier: 'nodefm-audio-1' },
      cover: { service: 'IMAGE', name: 'Owner', identifier: 'nodefm-cover-1' },
    });
  });

  it('generates the canonical Submission JSON for listener rows', () => {
    const batch = readyBatch('listener');
    const artifact = createBulkImportMetadataArtifact(
      batch,
      batch.rows[0],
      'Listener',
      'Q-listener',
    );

    expect(artifact.fileName).toBe('nodefm-track-submission-row-1.json');
    expect(JSON.parse(artifact.json)).toMatchObject({
      submissionId: 'row-1',
      submitterName: 'Listener',
      submitterAddress: 'Q-listener',
    });
  });

  it('keeps exported byte identity and detects a metadata change', () => {
    const batch = readyBatch();
    const artifact = createBulkImportMetadataArtifact(batch, batch.rows[0], 'Owner', 'Q-owner');

    expect(
      isBulkImportMetadataArtifactCurrent(batch, batch.rows[0], 'Owner', 'Q-owner', artifact),
    ).toBe(true);

    const changed = setBulkImportMetadataField(batch, 'row-1', 'title', 'New Title');
    expect(
      isBulkImportMetadataArtifactCurrent(changed, changed.rows[0], 'Owner', 'Q-owner', artifact),
    ).toBe(false);
  });

  it('requires AUDIO and required COVER before export', () => {
    const batch = readyBatch();
    const row = batch.rows[0];
    const noAudio = { ...batch, rows: [{ ...row, publication: createEmptyPublicationJournal() }] };
    expect(() =>
      buildBulkImportMetadataDocument(noAudio, noAudio.rows[0], 'Owner', 'Q-owner'),
    ).toThrow(/AUDIO must be published/);

    const noCover = {
      ...batch,
      rows: [
        {
          ...row,
          publication: { ...row.publication, cover: createEmptyPublicationJournal().cover },
        },
      ],
    };
    expect(() =>
      buildBulkImportMetadataDocument(noCover, noCover.rows[0], 'Owner', 'Q-owner'),
    ).toThrow(/COVER must be published/);
  });

  it('exports metadata without a cover reference when no cover exists', () => {
    const batch = readyBatch('admin', false);
    const artifact = createBulkImportMetadataArtifact(batch, batch.rows[0], 'Owner', 'Q-owner');
    const parsed = JSON.parse(artifact.json) as { cover?: unknown };
    expect(parsed.cover).toBeUndefined();
  });

  it('keeps export filenames safe and stable', () => {
    expect(getBulkImportMetadataExportFilename('row-1', 'admin')).toBe('nodefm-track-row-1.json');
    expect(getBulkImportMetadataExportFilename('row-1', 'listener')).toBe(
      'nodefm-track-submission-row-1.json',
    );
  });
});
