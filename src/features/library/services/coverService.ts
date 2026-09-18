/* ============================================================
 * NodeFM Station — Track Cover Publication Service
 *
 * Reusable optional cover image publication for station-owned
 * Track resources. This is the same proven browser File → base64
 * → IMAGE QDN flow used by the normal Track upload path.
 * ============================================================ */

import { publishMultipleResources, publishResource } from '../../../qortium/qdn';
import type { PublishMultipleResource } from '../../../qortium/qdn';
import type { QdnResourceRef, Track } from '../../../types/domain';
import {
  getCoverQdnIdentifier,
  getTrackQdnIdentifier,
  editTrack,
} from '../../tracks/services/trackService';
import { getTrackById, trackPublishResource, upsertTrackLocally } from './libraryService';
import type { EditTrackInput } from '../../tracks/services/trackService';

export const COVER_INLINE_MAX_BYTES = 2 * 1024 * 1024;

export function getCoverSizeError(fileSizeBytes: number): string | null {
  if (fileSizeBytes > COVER_INLINE_MAX_BYTES) {
    return `Cover image is too large (${(fileSizeBytes / 1024 / 1024).toFixed(1)} MB). Maximum is 2 MB.`;
  }
  return null;
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Cover file could not be read.'));
      }
    };
    reader.onerror = () => reject(new Error('Cover file could not be read.'));
    reader.readAsDataURL(file);
  });
}

export async function readCoverFile(file: File): Promise<{
  fileName: string;
  bytesBase64: string;
  mimeType: string;
  dataUrl: string;
}> {
  const sizeError = getCoverSizeError(file.size);
  if (sizeError) {
    throw new Error(sizeError);
  }

  const dataUrl = await fileToDataUrl(file);
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex < 0) {
    throw new Error('Cover file could not be converted to base64.');
  }

  return {
    fileName: file.name,
    bytesBase64: dataUrl.slice(commaIndex + 1),
    mimeType: file.type || 'application/octet-stream',
    dataUrl,
  };
}

export type PublishTrackCoverInput = {
  publisherName: string;
  title: string;
  file: File;
  bytesBase64: string;
};

function trackCoverPublishResource(input: PublishTrackCoverInput): {
  resource: PublishMultipleResource;
  ref: QdnResourceRef;
} {
  if (!input.publisherName.trim()) {
    throw new Error('A registered Qortium name is required to publish a cover.');
  }

  const sizeError = getCoverSizeError(input.file.size);
  if (sizeError) {
    throw new Error(sizeError);
  }

  const identifier = getCoverQdnIdentifier();
  const ref: QdnResourceRef = {
    service: 'IMAGE',
    name: input.publisherName.trim(),
    identifier,
  };

  return {
    resource: {
      service: 'IMAGE',
      name: input.publisherName.trim(),
      identifier,
      bytesBase64: input.bytesBase64,
      fileName: input.file.name,
      mimeType: input.file.type || 'application/octet-stream',
      title: `${input.title.trim() || 'Track'} cover`,
    },
    ref,
  };
}

/**
 * Build a cover resource and its QDN reference without publishing.
 * Kept separate from the private builder so the Upload Audio service can
 * prepare the complete media batch before publication.
 */
export function buildTrackCoverPublishResource(input: PublishTrackCoverInput): {
  resource: PublishMultipleResource;
  ref: QdnResourceRef;
} {
  return trackCoverPublishResource(input);
}

export async function publishTrackCoverImage(
  input: PublishTrackCoverInput,
): Promise<QdnResourceRef> {
  const { resource, ref } = trackCoverPublishResource(input);
  const result = await publishResource(resource);

  if (!result.accepted) {
    throw new Error('Cover publication was not accepted.');
  }

  return ref;
}

export type PublishAndUpdateTrackCoverInput = {
  trackId: string;
  title: string;
  publisherName: string;
  file: File;
  bytesBase64: string;
  /**
   * Any other metadata edits to apply in the same Track metadata resource
   * update. `cover` and `removeCover` are intentionally omitted from this
   * partial input because the new cover is appended after successful image
   * publication.
   */
  metadata?: Omit<EditTrackInput, 'cover' | 'removeCover'>;
};

/**
 * Publish a replacement cover first, then update the Track metadata only
 * after image publication succeeds.
 *
 * If image publication fails, this throws before `updateTrack()` is called,
 * so the current Track metadata and its old cover reference are preserved.
 */
export async function publishAndUpdateTrackCover(
  input: PublishAndUpdateTrackCoverInput,
): Promise<Track> {
  const cover = trackCoverPublishResource({
    publisherName: input.publisherName,
    title: input.title,
    file: input.file,
    bytesBase64: input.bytesBase64,
  });

  const current = getTrackById(input.trackId);
  if (!current) {
    throw new Error(`Track not found: ${input.trackId}`);
  }

  const track = editTrack(current, {
    ...(input.metadata ?? {}),
    cover: cover.ref,
  });

  const trackResource = trackPublishResource(track, input.publisherName);
  const response = await publishMultipleResources([cover.resource, trackResource]);
  const coverPublished = response.accepted
    ? response.published.some((entry) => entry.resource.identifier === cover.ref.identifier)
    : false;
  const trackIdentifier = getTrackQdnIdentifier(track.trackId);
  const trackPublished = response.accepted
    ? response.published.some((entry) => entry.resource.identifier === trackIdentifier)
    : false;

  if (!coverPublished || !trackPublished) {
    const coverFailure = response.failures.find(
      (entry) => entry.resource.identifier === cover.ref.identifier,
    );
    const trackFailure = response.failures.find(
      (entry) => entry.resource.identifier === trackIdentifier,
    );

    throw new Error(
      `Failed to save track cover: ${
        coverFailure?.error ??
        trackFailure?.error ??
        'QDN batch publication returned an incomplete result.'
      }`,
    );
  }

  return upsertTrackLocally(track);
}

export type PublishNewTrackWithCoverInput = {
  track: Track;
  publisherName: string;
  cover?: PublishTrackCoverInput;
};

export type PublishNewTrackWithCoverResult = {
  track: Track;
  coverPublished: boolean;
};

/**
 * Publish a newly-created station Track and, when supplied, its cover image
 * in one coordinated QDN publication request.
 */
export async function publishNewTrackWithCover(
  input: PublishNewTrackWithCoverInput,
): Promise<PublishNewTrackWithCoverResult> {
  const cover = input.cover
    ? trackCoverPublishResource({
        publisherName: input.cover.publisherName,
        title: input.cover.title,
        file: input.cover.file,
        bytesBase64: input.cover.bytesBase64,
      })
    : undefined;
  const trackResource = trackPublishResource(input.track, input.publisherName);
  const resources = cover ? [cover.resource, trackResource] : [trackResource];
  const response = await publishMultipleResources(resources);
  const trackIdentifier = trackResource.identifier;
  const trackPublished = response.accepted
    ? response.published.some((entry) => entry.resource.identifier === trackIdentifier)
    : false;

  if (!trackPublished) {
    const trackFailure = response.failures.find(
      (entry) => entry.resource.identifier === trackIdentifier,
    );
    throw new Error(
      `Failed to publish station track: ${
        trackFailure?.error ?? 'QDN batch publication returned no result for the track.'
      }`,
    );
  }

  if (
    cover &&
    !response.published.some((entry) => entry.resource.identifier === cover.ref.identifier)
  ) {
    const coverFailure = response.failures.find(
      (entry) => entry.resource.identifier === cover.ref.identifier,
    );
    throw new Error(
      `Failed to publish track cover: ${
        coverFailure?.error ?? 'QDN batch publication returned no result for the cover.'
      }`,
    );
  }

  return {
    track: upsertTrackLocally(input.track),
    coverPublished: Boolean(cover),
  };
}
