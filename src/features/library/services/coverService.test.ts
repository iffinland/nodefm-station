import { describe, expect, it, vi } from 'vitest';
import { publishResource } from '../../../qortium/qdn';
import { getCoverSizeError, publishTrackCoverImage } from './coverService';

vi.mock('../../../qortium/qdn', () => ({
  publishResource: vi.fn(),
}));

const mockedPublish = vi.mocked(publishResource);

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
});
