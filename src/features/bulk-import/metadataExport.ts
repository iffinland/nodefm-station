/* ============================================================
 * NodeFM Station — Bulk Import Canonical Metadata Export
 *
 * Materializes the exact NodeFM Track / Listener Submission JSON
 * bytes that Home 2 will publish from a native-selected file.
 *
 * This module reuses the existing canonical Track and Submission
 * serializers; it does not introduce a second metadata schema.
 * ============================================================ */

import type { ListenerTrackSubmission, QdnResourceRef, Track } from '../../types/domain';
import { serializeSubmissionForQdn } from '../listener-submissions/services/submissionService';
import { serializeTrackForQdn } from '../tracks/services/trackService';
import {
  computeAudioContentRevision,
  computeCoverContentRevision,
  computeMetadataContentRevision,
  stableContentFingerprint,
} from './contentRevision';
import { publicationStepMatchesContent } from './publicationJournal';
import type {
  BulkImportBatch,
  BulkImportPublicationPublishedStep,
  BulkImportPublicationReference,
  BulkImportPublicationStep,
  BulkImportRow,
} from './types';

export type BulkImportMetadataArtifact = {
  fileName: string;
  json: string;
  sizeBytes: number;
  /**
   * Deterministic local fingerprint of the exact exported byte string.
   * It is stable across repeated exports of the same row revision.
   */
  fingerprint: string;
  sourceGeneration: number;
  metadataRevision: string;
};

function currentPublishedStep(
  step: BulkImportPublicationStep,
  kind: 'audio' | 'cover',
  revision: string | null,
): BulkImportPublicationPublishedStep | null {
  return publicationStepMatchesContent(step, kind, revision) ? step : null;
}

function asReference(reference: BulkImportPublicationReference): QdnResourceRef {
  return reference.identifier
    ? {
        service: reference.service,
        name: reference.name,
        identifier: reference.identifier,
      }
    : {
        service: reference.service,
        name: reference.name,
      };
}

function emptyToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function emptyArrayToUndefined(value: string[]): string[] | undefined {
  return value.length > 0 ? [...value] : undefined;
}

function requiredPositiveDuration(durationMs: number | null): number {
  if (durationMs === null || !Number.isSafeInteger(durationMs) || durationMs <= 0) {
    throw new Error('A positive duration is required before metadata export.');
  }

  return durationMs;
}

function requiredActorName(name: string | null): string {
  const normalized = name?.trim();
  if (!normalized) {
    throw new Error('A registered Qortium name is required before metadata export.');
  }
  return normalized;
}

function requiredActorAddress(address: string | null): string {
  const normalized = address?.trim();
  if (!normalized) {
    throw new Error('An authenticated account is required before metadata export.');
  }
  return normalized;
}

function stableTimestamp(value: string | undefined): string {
  if (!value || Number.isNaN(Date.parse(value))) {
    return new Date(0).toISOString();
  }
  return value;
}

/**
 * Build the exact canonical metadata document for the current row.
 *
 * This intentionally throws when the AUDIO or required COVER dependency
 * has not been confirmed for the current row revision. Metadata must not
 * reference unpublished media.
 */
export function buildBulkImportMetadataDocument(
  batch: BulkImportBatch,
  row: BulkImportRow,
  actorName: string | null,
  actorAddress: string | null,
): string {
  const durationMs = requiredPositiveDuration(row.durationMs);
  const audioRevision = computeAudioContentRevision(row.localSource, row.sourceGeneration);
  const audioStep = currentPublishedStep(row.publication.audio, 'audio', audioRevision);

  if (!audioStep) {
    throw new Error('AUDIO must be published before metadata can be exported.');
  }

  const coverRevision = computeCoverContentRevision(row.cover);
  const coverStep =
    row.cover === null ? null : currentPublishedStep(row.publication.cover, 'cover', coverRevision);

  if (row.cover !== null && !coverStep) {
    throw new Error('COVER must be published before metadata can be exported.');
  }

  const title = row.metadata.title.trim();
  if (!title) {
    throw new Error('Track title is required before metadata export.');
  }

  const publisherName = requiredActorName(actorName);
  const publisherAddress = requiredActorAddress(actorAddress);
  const audio = asReference(audioStep.confirmed);
  const cover = coverStep ? asReference(coverStep.confirmed) : undefined;
  const artist = emptyToUndefined(row.metadata.artist);
  const album = emptyToUndefined(row.metadata.album);
  const releaseDate = emptyToUndefined(row.metadata.releaseDate);
  const genres = emptyArrayToUndefined(row.metadata.genres);
  const tags = emptyArrayToUndefined(row.metadata.tags);

  if (batch.role === 'listener') {
    const submission: ListenerTrackSubmission = {
      schemaVersion: 1,
      submissionId: row.id,
      submitterName: publisherName,
      submitterAddress: publisherAddress,
      title,
      artist,
      album,
      releaseDate,
      audio,
      cover,
      durationMs,
      genres,
      tags,
      submittedAt: stableTimestamp(batch.createdAt),
    };

    return serializeSubmissionForQdn(submission);
  }

  const track: Track = {
    schemaVersion: 1,
    trackId: row.id,
    ownerAddress: publisherAddress,
    title,
    artist,
    album,
    releaseDate,
    audio,
    cover,
    durationMs,
    genres,
    tags,
    source: 'station-upload',
    createdAt: stableTimestamp(batch.createdAt),
    updatedAt: stableTimestamp(batch.updatedAt ?? batch.createdAt),
  };

  return serializeTrackForQdn(track);
}

export function getBulkImportMetadataExportFilename(
  rowId: string,
  role: 'admin' | 'listener',
): string {
  const identity =
    role === 'listener' ? `nodefm-track-submission-${rowId}` : `nodefm-track-${rowId}`;
  return `${identity}.json`;
}

export function computeBulkImportMetadataFingerprint(json: string): string {
  return stableContentFingerprint(['bulk-metadata-json', json]);
}

export function createBulkImportMetadataArtifact(
  batch: BulkImportBatch,
  row: BulkImportRow,
  actorName: string | null,
  actorAddress: string | null,
): BulkImportMetadataArtifact {
  const json = buildBulkImportMetadataDocument(batch, row, actorName, actorAddress);

  return {
    fileName: getBulkImportMetadataExportFilename(row.id, batch.role),
    json,
    sizeBytes: new TextEncoder().encode(json).byteLength,
    fingerprint: computeBulkImportMetadataFingerprint(json),
    sourceGeneration: row.sourceGeneration,
    metadataRevision: computeMetadataContentRevision(row.metadata),
  };
}

export function isBulkImportMetadataArtifactCurrent(
  batch: BulkImportBatch,
  row: BulkImportRow,
  actorName: string | null,
  actorAddress: string | null,
  artifact: BulkImportMetadataArtifact,
): boolean {
  try {
    const json = buildBulkImportMetadataDocument(batch, row, actorName, actorAddress);
    return (
      json === artifact.json &&
      artifact.fingerprint === computeBulkImportMetadataFingerprint(json) &&
      artifact.sizeBytes === new TextEncoder().encode(json).byteLength
    );
  } catch {
    return false;
  }
}

export function downloadBulkImportMetadataArtifact(artifact: BulkImportMetadataArtifact): boolean {
  if (typeof document === 'undefined' || typeof URL === 'undefined') {
    throw new Error('Metadata download is available only in a browser environment.');
  }

  const blob = new Blob([artifact.json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = artifact.fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}
