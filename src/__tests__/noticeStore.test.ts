/* ============================================================
 * NodeFM Station — Notice Store Tests
 *
 * QDN multi-resource discovery, reconstruction, failure semantics,
 * and owner-managed mutations.
 * ============================================================ */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../qortium/qdn', () => ({
  deleteQdnResource: vi.fn(),
  fetchQdnResourceData: vi.fn(),
  publishResource: vi.fn(),
  searchQdnResources: vi.fn(),
}));

import {
  deleteQdnResource,
  fetchQdnResourceData,
  publishResource,
  searchQdnResources,
} from '../qortium/qdn';
import { createNotice, serializeNoticeForQdn } from '../features/notices/services/noticeService';
import {
  getNoticeError,
  getNoticeIncomplete,
  getNoticeRecords,
  loadNotices,
  resetNoticeStore,
  saveNotice,
  deleteNotice,
} from '../features/notices/services/noticeStore';

const mockedSearch = vi.mocked(searchQdnResources);
const mockedFetch = vi.mocked(fetchQdnResourceData);
const mockedPublish = vi.mocked(publishResource);
const mockedDelete = vi.mocked(deleteQdnResource);

function publishedResult(identifier: string) {
  return {
    accepted: true,
    action: 'PUBLISH_QDN_RESOURCE',
    resource: {
      identifier,
      name: 'station',
      service: 'JSON',
    },
  };
}

function noticePayload(message: string, noticeId: string) {
  return JSON.parse(
    serializeNoticeForQdn(createNotice({ message, title: undefined })).replace(
      /"noticeId":"[^"]+"/,
      `"noticeId":"${noticeId}"`,
    ),
  );
}

describe('notice store discovery', () => {
  beforeEach(() => {
    resetNoticeStore();
    mockedSearch.mockReset();
    mockedFetch.mockReset();
    mockedPublish.mockReset();
    mockedDelete.mockReset();
  });

  it('searches mode=ALL and deduplicates by publisher/identifier', async () => {
    mockedSearch.mockResolvedValue([
      {
        service: 'JSON',
        name: 'station',
        identifier: 'nodefm-notice-a',
        created: 1,
      },
      {
        service: 'JSON',
        name: 'station',
        identifier: 'nodefm-notice-a',
        created: 2,
      },
      {
        service: 'JSON',
        name: 'station',
        identifier: 'nodefm-notice-b',
        created: 3,
      },
    ]);
    mockedFetch.mockImplementation(async ({ identifier }) =>
      noticePayload('Message', (identifier as string).slice('nodefm-notice-'.length)),
    );

    await loadNotices('station');

    expect(mockedSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        service: 'JSON',
        name: 'station',
        query: 'nodefm-notice-',
        prefix: true,
        mode: 'ALL',
      }),
    );
    expect(getNoticeRecords()).toHaveLength(2);
  });

  it('keeps partial results and marks incomplete when a notice resource is unavailable', async () => {
    mockedSearch.mockResolvedValue([
      {
        service: 'JSON',
        name: 'station',
        identifier: 'nodefm-notice-a',
        created: 1,
      },
      {
        service: 'JSON',
        name: 'station',
        identifier: 'nodefm-notice-b',
        created: 2,
      },
    ]);
    mockedFetch.mockImplementation(async ({ identifier }) => {
      if (identifier === 'nodefm-notice-b') {
        throw new Error('resource does not exist');
      }

      return noticePayload('Good', (identifier as string).slice('nodefm-notice-'.length));
    });

    await loadNotices('station');

    expect(getNoticeRecords()).toHaveLength(1);
    expect(getNoticeIncomplete()).toBe(true);
  });

  it('rejects publisher mismatches without accepting their payloads', async () => {
    mockedSearch.mockResolvedValue([
      {
        service: 'JSON',
        name: 'mallory',
        identifier: 'nodefm-notice-a',
        created: 1,
      },
    ]);

    await loadNotices('station');

    expect(getNoticeRecords()).toHaveLength(0);
    expect(getNoticeIncomplete()).toBe(false);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('propagates search failure instead of reporting an empty notice state', async () => {
    mockedSearch.mockRejectedValue(new Error('search failed'));

    await loadNotices('station');

    expect(getNoticeError()).toBe('search failed');
    expect(getNoticeRecords()).toHaveLength(0);
  });
});

describe('notice store mutations', () => {
  beforeEach(() => {
    resetNoticeStore();
    mockedSearch.mockReset();
    mockedFetch.mockReset();
    mockedPublish.mockReset();
    mockedDelete.mockReset();
  });

  it('publishes and stores a notice only after the QDN publish is confirmed', async () => {
    mockedPublish.mockResolvedValue(publishedResult('nodefm-notice-confirmed'));

    const notice = createNotice({ message: 'Published notice' });
    await saveNotice(notice, 'station', 'Q-owner', 'Q-owner');

    expect(mockedPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        service: 'JSON',
        name: 'station',
        identifier: `nodefm-notice-${notice.noticeId}`,
      }),
    );
    expect(getNoticeRecords().map((record) => record.notice.message)).toEqual(['Published notice']);
  });

  it('does not mutate local state when publish fails', async () => {
    mockedPublish.mockRejectedValue(new Error('publish denied'));

    await expect(
      saveNotice(createNotice({ message: 'No' }), 'station', 'Q-owner', 'Q-owner'),
    ).rejects.toThrow(/publish denied/);
    expect(getNoticeRecords()).toHaveLength(0);
  });

  it('deletes only the requested QDN resource and then removes the local record', async () => {
    mockedPublish.mockResolvedValue(publishedResult('nodefm-notice-delete'));
    mockedDelete.mockResolvedValue({ accepted: true });

    const notice = createNotice({ message: 'Delete me' });
    await saveNotice(notice, 'station', 'Q-owner', 'Q-owner');
    await deleteNotice(notice.noticeId, 'station', 'Q-owner', 'Q-owner');

    expect(mockedDelete).toHaveBeenCalledWith({
      service: 'JSON',
      name: 'station',
      identifier: `nodefm-notice-${notice.noticeId}`,
    });
    expect(getNoticeRecords()).toHaveLength(0);
  });

  it('rejects non-owner notice mutations before touching the bridge', async () => {
    await expect(
      saveNotice(createNotice({ message: 'Not owner' }), 'station', 'Q-mallory', 'Q-owner'),
    ).rejects.toThrow(/Only the station owner/);
    expect(mockedPublish).not.toHaveBeenCalled();
  });
});
