import { describe, expect, it, vi } from 'vitest';
import { publishMultipleResources, publishResource } from '../../../qortium/qdn';
import { getTrackById, trackPublishResource, upsertTrackLocally } from './libraryService';
import {
  getCoverSizeError,
  publishAndUpdateTrackCover,
  publishTrackCoverImage,
} from './coverService';

vi.mock('../../../qortium/qdn', () => ({
  publishMultipleResources: vi.fn(),
  publishResource: vi.fn(),
}));

vi.mock('./libraryService', () => ({
  getTrackById: vi.fn(),
  trackPublishResource: vi.fn(),
  upsertTrackLocally: vi.fn(),
}));

const mockedPublish = vi.mocked(publishResource);
const mockedBatchPublish = vi.mocked(publishMultipleResources);
const mockedGetTrack = vi.mocked(getTrackById);
const mockedTrackPublishResource = vi.mocked(trackPublishResource);
const mockedUpsertTrack = vi.mocked(upsertTrackLocally);

describe('cover size validation', () => {
  it('rejects files over the 2 MB inline limit', () => {
    expect(getCoverSizeError(2 * 1024 * 1024 + 1)).toContain('too large');
  });

  it('allows files at or below the inline limit', () => {
    expect(getCoverSizeError(2 * 1024 * 1024)).toBeNull();
  });
});

describe('publishTrackCoverImage', () => {
  it('publishes a distinct IMAGE resource and returns its QDN reference', async () => {
    mockedPublish.mockReset();
    mockedPublish.mockResolvedValue({
      accepted: true,
      action: 'PUBLISH_QDN_RESOURCE',
      resource: { identifier: 'nodefm-cover-x', name: 'NodeFM', service: 'IMAGE' },
    } as never);

    const file = new File(['cover'], 'cover.png', { type: 'image/png' });
    const ref = await publishTrackCoverImage({
      publisherName: 'NodeFM',
      title: 'My Track',
      file,
      data64: 'aGVsbG8=',
    });

    expect(mockedPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        service: 'IMAGE',
        name: 'NodeFM',
        data64: 'aGVsbG8=',
        filename: 'cover.png',
        title: 'My Track cover',
      }),
    );
    expect(ref.service).toBe('IMAGE');
    expect(ref.name).toBe('NodeFM');
    expect(ref.identifier).toMatch(/^nodefm-cover-/);
  });

  it('does not return a cover reference when publication is not accepted', async () => {
    mockedPublish.mockReset();
    mockedPublish.mockResolvedValue({
      accepted: false,
      action: 'PUBLISH_QDN_RESOURCE',
      resource: { identifier: 'nodefm-cover-x', name: 'NodeFM', service: 'IMAGE' },
    } as never);

    await expect(
      publishTrackCoverImage({
        publisherName: 'NodeFM',
        title: 'My Track',
        file: new File(['cover'], 'cover.png', { type: 'image/png' }),
        data64: 'aGVsbG8=',
      }),
    ).rejects.toThrow(/not accepted/i);
  });

  it('updates Track metadata only after a successful cover publish', async () => {
    mockedPublish.mockReset();
    mockedBatchPublish.mockReset();
    mockedGetTrack.mockReset();
    mockedTrackPublishResource.mockReset();
    mockedUpsertTrack.mockReset();
    mockedGetTrack.mockReturnValue({
      schemaVersion: 1,
      trackId: 'track-1',
      ownerAddress: 'Q-owner',
      title: 'Track',
      audio: { service: 'AUDIO', name: 'NodeFM' },
      durationMs: 1000,
      source: 'station-upload',
      createdAt: '2026-08-29T00:00:00.000Z',
      updatedAt: '2026-08-29T00:00:00.000Z',
    });
    mockedTrackPublishResource.mockReturnValue({
      service: 'JSON',
      name: 'NodeFM',
      identifier: 'nodefm-track-track-1',
      data64: 'dHJhY2s=',
      title: 'Updated Track',
    });
    mockedBatchPublish.mockImplementation(async (resources) => ({
      accepted: true,
      action: 'PUBLISH_MULTIPLE_QDN_RESOURCES',
      published: resources.map((resource) => ({
        result: {},
        resource: {
          identifier: resource.identifier ?? null,
          name: resource.name,
          service: resource.service,
        },
        transactionSignature: 'signature',
      })),
      failures: [],
    }));
    mockedUpsertTrack.mockImplementation((track) => track);

    const file = new File(['cover'], 'cover.png', { type: 'image/png' });

    await publishAndUpdateTrackCover({
      trackId: 'track-1',
      title: 'Track',
      publisherName: 'NodeFM',
      file,
      data64: 'aGVsbG8=',
      metadata: { title: 'Updated Track' },
    });

    expect(mockedBatchPublish).toHaveBeenCalledTimes(1);
    expect(mockedBatchPublish.mock.calls[0][0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ service: 'IMAGE', name: 'NodeFM' }),
        expect.objectContaining({ service: 'JSON', name: 'NodeFM' }),
      ]),
    );
    expect(mockedUpsertTrack).toHaveBeenCalledTimes(1);
  });

  it('does not update Track metadata when cover publication fails', async () => {
    mockedPublish.mockReset();
    mockedBatchPublish.mockReset();
    mockedGetTrack.mockReset();
    mockedTrackPublishResource.mockReset();
    mockedUpsertTrack.mockReset();
    mockedGetTrack.mockReturnValue({
      schemaVersion: 1,
      trackId: 'track-1',
      ownerAddress: 'Q-owner',
      title: 'Track',
      audio: { service: 'AUDIO', name: 'NodeFM' },
      durationMs: 1000,
      source: 'station-upload',
      createdAt: '2026-08-29T00:00:00.000Z',
      updatedAt: '2026-08-29T00:00:00.000Z',
    });
    mockedTrackPublishResource.mockReturnValue({
      service: 'JSON',
      name: 'NodeFM',
      identifier: 'nodefm-track-track-1',
      data64: 'dHJhY2s=',
      title: 'Track',
    });
    mockedBatchPublish.mockResolvedValue({
      accepted: false,
      action: 'PUBLISH_MULTIPLE_QDN_RESOURCES',
      published: [],
      failures: [],
    });

    await expect(
      publishAndUpdateTrackCover({
        trackId: 'track-1',
        title: 'Track',
        publisherName: 'NodeFM',
        file: new File(['cover'], 'cover.png', { type: 'image/png' }),
        data64: 'aGVsbG8=',
      }),
    ).rejects.toThrow(/Failed to save track cover/);

    expect(mockedUpsertTrack).not.toHaveBeenCalled();
  });
});
