import { describe, expect, it, vi } from 'vitest';
import { publishMultipleResources } from '../../../qortium/qdn';
import { trackPublishResource } from './libraryService';
import { buildTrackCoverPublishResource } from './coverService';
import {
  buildUploadAudioPublishResource,
  publishUploadMediaResources,
  publishUploadTrackMetadata,
} from './uploadService';

vi.mock('../../../qortium/qdn', () => ({
  qdnJsonPublishFileName: (identifier: string) => `${identifier}.json`,
  publishMultipleResources: vi.fn(),
}));

vi.mock('./libraryService', () => ({
  trackPublishResource: vi.fn(),
}));

vi.mock('./coverService', () => ({
  buildTrackCoverPublishResource: vi.fn(),
}));

const mockedBatchPublish = vi.mocked(publishMultipleResources);
const mockedTrackPublishResource = vi.mocked(trackPublishResource);
const mockedBuildCover = vi.mocked(buildTrackCoverPublishResource);

describe('buildUploadAudioPublishResource', () => {
  it('publishes the AUDIO item with a Home-issued sourceToken only', () => {
    const resource = buildUploadAudioPublishResource({
      publisherName: 'NodeFM',
      audioIdentifier: 'nodefm-audio-1',
      audioSourceToken: 'token-1',
      title: 'Song',
    });

    expect(resource).toEqual({
      service: 'AUDIO',
      name: 'NodeFM',
      identifier: 'nodefm-audio-1',
      sourceToken: 'token-1',
      title: 'Song',
    });
  });
});

describe('publishUploadMediaResources', () => {
  it('publishes AUDIO and IMAGE cover in one multi-resource approval', async () => {
    mockedBatchPublish.mockReset();
    mockedBuildCover.mockReset();

    mockedBuildCover.mockReturnValue({
      resource: {
        service: 'IMAGE',
        name: 'NodeFM',
        identifier: 'nodefm-cover-1',
        bytesBase64: 'aW1hZ2U=',
        fileName: 'cover.png',
        mimeType: 'image/png',
      },
      ref: { service: 'IMAGE', name: 'NodeFM', identifier: 'nodefm-cover-1' },
    });

    mockedBatchPublish.mockResolvedValue({
      accepted: true,
      action: 'PUBLISH_MULTIPLE_QDN_RESOURCES',
      published: [
        {
          result: {},
          resource: { identifier: 'nodefm-audio-1', name: 'NodeFM', service: 'AUDIO' },
          transactionSignature: 'sig-audio',
        },
        {
          result: {},
          resource: { identifier: 'nodefm-cover-1', name: 'NodeFM', service: 'IMAGE' },
          transactionSignature: 'sig-cover',
        },
      ],
      failures: [],
    });

    const result = await publishUploadMediaResources({
      publisherName: 'NodeFM',
      audioIdentifier: 'nodefm-audio-1',
      audioSourceToken: 'token-1',
      title: 'Song',
      cover: {
        publisherName: 'NodeFM',
        title: 'Song',
        file: new File(['cover'], 'cover.png', { type: 'image/png' }),
        bytesBase64: 'aW1hZ2U=',
      },
    });

    expect(mockedBatchPublish).toHaveBeenCalledTimes(1);
    const resources = mockedBatchPublish.mock.calls[0][0];
    expect(resources).toHaveLength(2);
    expect(resources[0]).toEqual(
      expect.objectContaining({ service: 'AUDIO', sourceToken: 'token-1' }),
    );
    expect(resources[1]).toEqual(expect.objectContaining({ service: 'IMAGE' }));
    expect(result.audioPublished).toBe(true);
    expect(result.coverPublished).toBe(true);
    expect(result.coverRef).toEqual({
      service: 'IMAGE',
      name: 'NodeFM',
      identifier: 'nodefm-cover-1',
    });
  });

  it('reports a partial result when the audio resource fails', async () => {
    mockedBatchPublish.mockReset();
    mockedBuildCover.mockReset();

    mockedBuildCover.mockReturnValue({
      resource: {
        service: 'IMAGE',
        name: 'NodeFM',
        identifier: 'nodefm-cover-1',
        bytesBase64: 'aW1hZ2U=',
        fileName: 'cover.png',
        mimeType: 'image/png',
      },
      ref: { service: 'IMAGE', name: 'NodeFM', identifier: 'nodefm-cover-1' },
    });

    mockedBatchPublish.mockResolvedValue({
      accepted: true,
      action: 'PUBLISH_MULTIPLE_QDN_RESOURCES',
      published: [],
      failures: [
        {
          error: 'audio failed',
          resource: { identifier: 'nodefm-audio-1', name: 'NodeFM', service: 'AUDIO' },
        },
      ],
    });

    const result = await publishUploadMediaResources({
      publisherName: 'NodeFM',
      audioIdentifier: 'nodefm-audio-1',
      audioSourceToken: 'token-1',
      title: 'Song',
      cover: {
        publisherName: 'NodeFM',
        title: 'Song',
        file: new File(['cover'], 'cover.png', { type: 'image/png' }),
        bytesBase64: 'aW1hZ2U=',
      },
    });

    expect(result.audioPublished).toBe(false);
    expect(result.coverPublished).toBe(false);
  });
});

describe('publishUploadTrackMetadata', () => {
  it('publishes the Track JSON resource and succeeds when Home returns it', async () => {
    mockedBatchPublish.mockReset();
    mockedTrackPublishResource.mockReset();

    mockedTrackPublishResource.mockReturnValue({
      service: 'JSON',
      name: 'NodeFM',
      identifier: 'nodefm-track-t1',
      bytesBase64: 'e30=',
      fileName: 'nodefm-track-t1.json',
      mimeType: 'application/json',
      title: 'Song',
    });

    mockedBatchPublish.mockResolvedValue({
      accepted: true,
      action: 'PUBLISH_MULTIPLE_QDN_RESOURCES',
      published: [
        {
          result: {},
          resource: { identifier: 'nodefm-track-t1', name: 'NodeFM', service: 'JSON' },
          transactionSignature: 'sig-track',
        },
      ],
      failures: [],
    });

    const track = {
      schemaVersion: 1,
      trackId: 't1',
      ownerAddress: 'Q-owner',
      title: 'Song',
      audio: { service: 'AUDIO', name: 'NodeFM', identifier: 'nodefm-audio-1' },
      durationMs: 1000,
      source: 'station-upload',
      createdAt: '2026-08-31T00:00:00.000Z',
      updatedAt: '2026-08-31T00:00:00.000Z',
    } as never;

    await publishUploadTrackMetadata(track, 'NodeFM');

    expect(mockedBatchPublish).toHaveBeenCalledWith([
      expect.objectContaining({ service: 'JSON', identifier: 'nodefm-track-t1' }),
    ]);
  });

  it('throws the real failure when the Track JSON resource is not published', async () => {
    mockedBatchPublish.mockReset();
    mockedTrackPublishResource.mockReset();

    mockedTrackPublishResource.mockReturnValue({
      service: 'JSON',
      name: 'NodeFM',
      identifier: 'nodefm-track-t1',
      bytesBase64: 'e30=',
      fileName: 'nodefm-track-t1.json',
      mimeType: 'application/json',
      title: 'Song',
    });

    mockedBatchPublish.mockResolvedValue({
      accepted: true,
      action: 'PUBLISH_MULTIPLE_QDN_RESOURCES',
      published: [],
      failures: [
        {
          error: 'track failed',
          resource: { identifier: 'nodefm-track-t1', name: 'NodeFM', service: 'JSON' },
        },
      ],
    });

    const track = {
      schemaVersion: 1,
      trackId: 't1',
      ownerAddress: 'Q-owner',
      title: 'Song',
      audio: { service: 'AUDIO', name: 'NodeFM', identifier: 'nodefm-audio-1' },
      durationMs: 1000,
      source: 'station-upload',
      createdAt: '2026-08-31T00:00:00.000Z',
      updatedAt: '2026-08-31T00:00:00.000Z',
    } as never;

    await expect(publishUploadTrackMetadata(track, 'NodeFM')).rejects.toThrow('track failed');
  });
});
