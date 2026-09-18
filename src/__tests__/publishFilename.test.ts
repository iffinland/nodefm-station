/* ============================================================
 * NodeFM Station — QDN Publish Filename Tests
 *
 * Covers the Unicode/security boundary exercised by local file
 * publication flows against the Home 2.1 staging contract.
 * ============================================================ */

import { describe, expect, it } from 'vitest';
import { isQdnPublishFilenameSafe, resolveQdnPublishFilename } from '../qortium/publishFilename';

describe('resolveQdnPublishFilename', () => {
  it.each([
    'Metsajärve öö äöõü — русский тест.mp3',
    'Metsajärve öö.mp3',
    'Põhjamaa hääl.flac',
    'Üks lugu.ogg',
    'Ääni yössä.wav',
    'cover õhtu.png',
    'café.mp3',
    'ファイル.mp3',
    '歌曲.flac',
  ])('keeps the original Unicode filename %j for Home staging', (filename) => {
    const result = resolveQdnPublishFilename(filename);

    expect(result.display).toBe(filename);
    expect(result.staged).toBe(filename);
    expect(isQdnPublishFilenameSafe(filename)).toBe(true);
  });

  it('preserves Estonian and Cyrillic characters, spaces and the em dash', () => {
    const filename = 'Metsajärve öö äöõü — русский тест.mp3';
    const result = resolveQdnPublishFilename(filename);

    for (const character of ['ä', 'ö', 'õ', 'ü', '—', 'р', 'у', 'с', 'к', 'и', 'й', ' ']) {
      expect(result.staged).toContain(character);
    }

    expect(result.staged.endsWith('.mp3')).toBe(true);
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
    expect(resolveQdnPublishFilename(filename)).toEqual({
      display: filename,
      staged: filename,
    });
    expect(isQdnPublishFilenameSafe(filename)).toBe(true);
  });

  it('uses a fallback for missing filenames', () => {
    expect(resolveQdnPublishFilename('', 'qdn-cover')).toEqual({
      display: 'qdn-cover',
      staged: 'qdn-cover',
    });
    expect(resolveQdnPublishFilename(undefined, 'qdn-cover').staged).toBe('qdn-cover');
  });

  it('does not transliterate or hash Unicode', () => {
    const result = resolveQdnPublishFilename('Põhjamaa.mp3');

    expect(result.staged).toBe('Põhjamaa.mp3');
    expect(result.staged).not.toContain('Pohjamaa');
    expect(result.staged).not.toMatch(/^nodefm-upload-/);
  });

  it('normalizes an NFD filename to NFC without losing characters', () => {
    const decomposed = 'Metsaja\u0308rve o\u0308o\u0308.mp3';
    const result = resolveQdnPublishFilename(decomposed);

    expect(result.staged).toBe('Metsajärve öö.mp3');
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
    expect(() => resolveQdnPublishFilename(filename)).toThrow(/Unsafe QDN publish filename/);
  });

  it('rejects a Unicode filename only when it also contains a path separator', () => {
    expect(() => resolveQdnPublishFilename('Põhjamaa/../hääl.flac')).toThrow(
      /Unsafe QDN publish filename/,
    );
  });
});
