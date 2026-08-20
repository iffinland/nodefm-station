/* ============================================================
 * NodeFM Station — Track Cover Publication Service
 *
 * Reusable optional cover image publication for station-owned
 * Track resources. This is the same proven browser File → base64
 * → IMAGE QDN flow used by the normal Track upload path.
 * ============================================================ */

import { publishResource } from '../../../qortium/qdn';
import type { QdnResourceRef } from '../../../types/domain';
import { getCoverQdnIdentifier } from '../../tracks/services/trackService';

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
  data64: string;
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
    data64: dataUrl.slice(commaIndex + 1),
    dataUrl,
  };
}

export type PublishTrackCoverInput = {
  publisherName: string;
  title: string;
  file: File;
  data64: string;
};

export async function publishTrackCoverImage(
  input: PublishTrackCoverInput,
): Promise<QdnResourceRef> {
  if (!input.publisherName.trim()) {
    throw new Error('A registered Qortium name is required to publish a cover.');
  }

  const sizeError = getCoverSizeError(input.file.size);
  if (sizeError) {
    throw new Error(sizeError);
  }

  const identifier = getCoverQdnIdentifier();
  const result = await publishResource({
    service: 'IMAGE',
    name: input.publisherName,
    identifier,
    data64: input.data64,
    title: `${input.title.trim() || 'Track'} cover`,
    filename: input.file.name,
  });

  if (!result.accepted) {
    throw new Error('Cover publication was not accepted.');
  }

  return {
    service: 'IMAGE',
    name: input.publisherName.trim(),
    identifier,
  };
}
