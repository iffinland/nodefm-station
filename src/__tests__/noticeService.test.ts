/* ============================================================
 * NodeFM Station — Notice Service Tests
 *
 * Validation, identity, and active-window behavior for notices.
 * ============================================================ */

import { describe, expect, it } from 'vitest';
import {
  createNotice,
  editNotice,
  getActiveNotices,
  getNoticeQdnIdentifier,
  isStationNoticeRecord,
  serializeNoticeForQdn,
  deserializeNoticeFromQdn,
} from '../features/notices/services/noticeService';

describe('notice QDN identity', () => {
  it('uses the stable nodefm-notice prefix', () => {
    expect(getNoticeQdnIdentifier('notice-1')).toBe('nodefm-notice-notice-1');
  });
});

describe('notice validation and active windows', () => {
  it('creates a valid notice with optional title and active window', () => {
    const notice = createNotice({
      title: 'Maintenance',
      message: 'Scheduled downtime tonight.',
      activeFromUtc: '2026-08-19T20:00:00.000Z',
      activeUntilUtc: '2026-08-20T02:00:00.000Z',
    });

    expect(notice.title).toBe('Maintenance');
    expect(notice.noticeId).toBeTruthy();
    expect(isStationNoticeRecord(notice)).toBe(true);
  });

  it('rejects an inverted active window', () => {
    expect(() =>
      createNotice({
        message: 'Bad window',
        activeFromUtc: '2026-08-20T02:00:00.000Z',
        activeUntilUtc: '2026-08-19T20:00:00.000Z',
      }),
    ).toThrow(/later than/);
  });

  it('rejects malformed UTC timestamps', () => {
    expect(() =>
      createNotice({
        message: 'Bad timestamp',
        activeFromUtc: 'not-a-date',
      }),
    ).toThrow(/valid UTC/);
  });

  it('edits only supplied fields and trims text', () => {
    const notice = createNotice({ message: 'Original', title: 'Title' });
    const edited = editNotice(notice, { message: '  Updated  ' });

    expect(edited.message).toBe('Updated');
    expect(edited.title).toBe('Title');
  });
});

describe('notice active-window filtering', () => {
  const always = createNotice({ message: 'Always visible' });
  const windowed = createNotice({
    message: 'Windowed',
    activeFromUtc: '2026-08-19T00:00:00.000Z',
    activeUntilUtc: '2026-08-20T00:00:00.000Z',
  });

  it('returns only currently active notices', () => {
    const active = getActiveNotices([always, windowed], Date.parse('2026-08-19T12:00:00.000Z'));

    expect(active.map((notice) => notice.message)).toEqual(['Always visible', 'Windowed']);
  });

  it('excludes notices outside their active window', () => {
    const active = getActiveNotices([always, windowed], Date.parse('2026-08-21T12:00:00.000Z'));

    expect(active.map((notice) => notice.message)).toEqual(['Always visible']);
  });
});

describe('notice serialization', () => {
  it('round-trips a valid notice', () => {
    const notice = createNotice({ title: 'T', message: 'M' });
    const parsed = deserializeNoticeFromQdn(JSON.parse(serializeNoticeForQdn(notice)));

    expect(parsed).toEqual(notice);
  });

  it('rejects a malformed notice payload', () => {
    expect(deserializeNoticeFromQdn({ noticeId: '', message: 'Missing id' })).toBeNull();
  });
});
