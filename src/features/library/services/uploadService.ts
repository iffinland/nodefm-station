/* ============================================================
 * NodeFM Station — Upload Audio Publication Service
 *
 * Scoped service for the owner "Upload Audio" flow. It prepares the
 * AUDIO (Home-issued sourceToken from SELECT_QDN_PUBLISH_SOURCE) and
 * optional IMAGE (app-held bytes staged with STAGE_QDN_PUBLISH_SOURCE)
 * resources as one `PUBLISH_MULTIPLE_QDN_RESOURCES` approval, then
 * publishes the final Track JSON metadata in a second approval after the
 * audio duration has been resolved from the now-published AUDIO resource.
 *
 * Home 1.8.0's SELECT_QDN_PUBLISH_SOURCE returns only a sourceToken,
 * file name, kind, and size. It deliberately does not return file
 * bytes or a local path, so duration cannot be read from the selected
 * source before publication while still using the sourceToken
 * transport. That is the specific runtime boundary that prevents one
 * single approval for the complete Track.
 * ============================================================ */

import {
  publishMultipleResources,
  type MultiplePublishResult,
  type PublishMultipleResource,
} from '../../../qortium/qdn';
import type { QdnResourceRef, Track } from '../../../types/domain';
import { buildTrackCoverPublishResource, type PublishTrackCoverInput } from './coverService';
import { trackPublishResource } from './libraryService';

export type PublishUploadMediaResourcesInput = {
  publisherName: string;
  audioIdentifier: string;
  audioSourceToken: string;
  title: string;
  cover?: PublishTrackCoverInput;
};

export type PublishUploadMediaResourcesResult = {
  audioPublished: boolean;
  coverPublished: boolean;
  coverRef: QdnResourceRef | undefined;
  response: MultiplePublishResult;
};

function normalizeService(value: string): string {
  return value.trim().toUpperCase();
}

function publishedIdentifier(
  response: MultiplePublishResult,
  service: string,
  identifier: string,
): boolean {
  return (
    response.accepted &&
    response.published.some(
      (entry) =>
        normalizeService(entry.resource.service) === normalizeService(service) &&
        entry.resource.identifier === identifier,
    )
  );
}

export function buildUploadAudioPublishResource(input: {
  publisherName: string;
  audioIdentifier: string;
  audioSourceToken: string;
  title: string;
}): PublishMultipleResource {
  if (!input.publisherName.trim()) {
    throw new Error('A registered Qortium name is required to publish audio.');
  }

  if (!input.audioIdentifier.trim()) {
    throw new Error('An audio identifier is required to publish audio.');
  }

  if (!input.audioSourceToken.trim()) {
    throw new Error('An audio source token is required to publish audio.');
  }

  return {
    service: 'AUDIO',
    name: input.publisherName.trim(),
    identifier: input.audioIdentifier.trim(),
    sourceToken: input.audioSourceToken.trim(),
    title: input.title.trim(),
  };
}

/**
 * Publish the selected AUDIO source and optional cover image through one
 * `PUBLISH_MULTIPLE_QDN_RESOURCES` approval.
 */
export async function publishUploadMediaResources(
  input: PublishUploadMediaResourcesInput,
): Promise<PublishUploadMediaResourcesResult> {
  const audioResource = buildUploadAudioPublishResource({
    publisherName: input.publisherName,
    audioIdentifier: input.audioIdentifier,
    audioSourceToken: input.audioSourceToken,
    title: input.title,
  });

  const cover = input.cover
    ? buildTrackCoverPublishResource({
        publisherName: input.cover.publisherName,
        title: input.cover.title,
        file: input.cover.file,
        bytesBase64: input.cover.bytesBase64,
      })
    : undefined;

  const resources = cover ? [audioResource, cover.resource] : [audioResource];
  const response = await publishMultipleResources(resources);

  const audioPublished = publishedIdentifier(response, 'AUDIO', audioResource.identifier ?? '');
  const coverPublished = cover
    ? publishedIdentifier(response, 'IMAGE', cover.ref.identifier ?? '')
    : true;

  return {
    audioPublished,
    coverPublished,
    coverRef: cover?.ref,
    response,
  };
}

/**
 * Publish the complete Track metadata resource after AUDIO (and cover, if
 * selected) have been published and duration has been resolved.
 */
export async function publishUploadTrackMetadata(
  track: Track,
  publisherName: string,
): Promise<void> {
  const resource = trackPublishResource(track, publisherName);
  const response = await publishMultipleResources([resource]);
  const published = publishedIdentifier(response, 'JSON', resource.identifier ?? '');

  if (!published) {
    const failure = response.failures.find(
      (entry) => entry.resource.identifier === resource.identifier,
    );
    throw new Error(
      `Failed to publish track metadata: ${
        failure?.error ?? 'QDN batch publication returned no result for the track.'
      }`,
    );
  }
}
