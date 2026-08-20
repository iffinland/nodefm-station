/* ============================================================
 * NodeFM Station — QDN Publish Filename Tests
 *
 * Covers the Unicode/security boundary exercised by local file
 * publication flows.
 * ============================================================ */

import { describe, expect, it } from 'vitest';
import {
  isQdnTransportFilenameSafe,
  normalizeQdnPublishFilename,
} from '../qortium/publishFilename';

describe('normalizeQdnPublishFilename', () => {
  it.each([
    'Metsajärve öö.mp3',
    'Põhjamaa hääl.flac',
    'Üks lugu.ogg',
    'Ääni yössä.wav',
    'cover õhtu.png',
    'café.mp3',
    'ファイル.mp3',
    '歌曲.flac',
  ])('maps Unicode filename %j to an ASCII transport filename', (filename) => {
    const result = normalizeQdnPublishFilename(filename);

    expect(result.display).toBe(filename);
    expect(result.transport).not.toBe(filename);
    expect(result.transport).toMatch(/^nodefm-upload-[a-z0-9]+\.(?:mp3|flac|ogg|wav|png|bin)$/);
    expect(result.transport).toMatch(/^[\x20-\x7e]+$/);
  });

  it.each([
    'plain.mp3',
    'with spaces.mp3',
    'with (parentheses).flac',
    'with-hyphen.ogg',
    'with_underscore.wav',
    'multiple.dots.mp3',
    'camelCase.M4A',
  ])('preserves normal ASCII filename %j unchanged', (filename) => {
    expect(normalizeQdnPublishFilename(filename)).toEqual({
      display: filename,
      transport: filename,
    });
    expect(isQdnTransportFilenameSafe(filename)).toBe(true);
  });

  it('uses a fallback for missing filenames', () => {
    expect(normalizeQdnPublishFilename('', 'qdn-cover')).toEqual({
      display: 'qdn-cover',
      transport: 'qdn-cover',
    });
    expect(normalizeQdnPublishFilename(undefined, 'qdn-cover').transport).toBe('qdn-cover');
  });

  it('preserves the original filename for display when transport is generated', () => {
    const result = normalizeQdnPublishFilename('Põhjamaa hääl.flac');

    expect(result.display).toBe('Põhjamaa hääl.flac');
    expect(result.transport.endsWith('.flac')).toBe(true);
  });

  it('does not transliterate Unicode', () => {
    const result = normalizeQdnPublishFilename('Põhjamaa.mp3');

    expect(result.transport).not.toContain('Pohjamaa');
    expect(result.display).toBe('Põhjamaa.mp3');
  });
});

describe('unsafe QDN publish filename rejection', () => {
  it.each([
    '../escape.mp3',
    '..\\escape.mp3',
    '/absolute/path.mp3',
    '\\absolute\\path.mp3',
    'C:\\path\\file.mp3',
    'C:/path/file.mp3',
    '.',
    '..',
    'file\u0000name.mp3',
    'file\nname.mp3',
    'file\tname.mp3',
  ])('rejects dangerous filename/path input %j', (filename) => {
    expect(() => normalizeQdnPublishFilename(filename)).toThrow(/Unsafe QDN publish filename/);
  });

  it('rejects a Unicode filename only when it also contains a path separator', () => {
    expect(() => normalizeQdnPublishFilename('Põhjamaa/../hääl.flac')).toThrow(
      /Unsafe QDN publish filename/,
    );
  });
});
