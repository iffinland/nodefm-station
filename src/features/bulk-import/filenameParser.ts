/* ============================================================
 * NodeFM Station — Bulk Import Filename Parser
 *
 * Pure `Artist - Title.ext` inference. This parser is intentionally
 * conservative:
 *   - only a recognized audio extension is stripped;
 *   - a leading track-number prefix is accepted only when a real
 *     Artist/Title separator remains afterward;
 *   - stray leading/trailing separators are ignored;
 *   - when the name is ambiguous the whole stem becomes Title and
 *     Artist stays empty rather than being invented.
 * ============================================================ */

export type FilenameParseResult = {
  artist: string;
  title: string;
};

const SEPARATOR_PATTERN = /\s+(?:-|–|—)\s+/u;
const LEADING_TRACK_NUMBER = /^\s*\d{1,4}\s*[-–—]\s+/u;
const LEADING_DOTTED_TRACK_NUMBER = /^\s*\d{1,4}\.\s+/u;
const LEADING_SEPARATOR = /^\s*[-–—]\s+/u;
const TRAILING_SEPARATOR = /\s+[-–—]\s*$/u;

const RECOGNIZED_AUDIO_EXTENSIONS = new Set([
  'aac',
  'aif',
  'aiff',
  'alac',
  'ape',
  'flac',
  'm4a',
  'm4b',
  'mka',
  'mp3',
  'mp4',
  'mpc',
  'ogg',
  'oga',
  'opus',
  'wav',
  'webm',
  'wma',
  'wv',
]);

function stripRecognizedExtension(filename: string): string {
  if (!filename.trim()) return '';

  const lastDot = filename.lastIndexOf('.');

  if (lastDot <= 0 || lastDot === filename.length - 1) {
    return filename;
  }

  const extension = filename.slice(lastDot + 1).toLowerCase();
  if (!RECOGNIZED_AUDIO_EXTENSIONS.has(extension)) {
    return filename;
  }

  return filename.slice(0, lastDot);
}

function stripLeadingTrackNumber(stem: string): string {
  for (const pattern of [LEADING_TRACK_NUMBER, LEADING_DOTTED_TRACK_NUMBER]) {
    const match = pattern.exec(stem);
    if (!match) continue;

    const remainder = stem.slice(match[0].length);
    if (SEPARATOR_PATTERN.test(remainder)) {
      return remainder;
    }
  }

  return stem;
}

function stripEdgeSeparators(stem: string): string {
  return stem.replace(TRAILING_SEPARATOR, '').replace(LEADING_SEPARATOR, '');
}

export function parseArtistTitleFromFilename(filename: string): FilenameParseResult {
  const stem = stripRecognizedExtension(filename).trim();

  if (!stem) {
    return { artist: '', title: '' };
  }

  const withoutEdges = stripEdgeSeparators(stem).trim();
  const candidate = stripLeadingTrackNumber(withoutEdges);

  const match = SEPARATOR_PATTERN.exec(candidate);

  if (!match || match.index === undefined) {
    return { artist: '', title: candidate.trim() };
  }

  const artist = candidate.slice(0, match.index).trim();
  const title = candidate.slice(match.index + match[0].length).trim();

  if (!artist || !title) {
    return { artist: '', title: (title || artist || candidate).trim() };
  }

  if (/^\d+$/u.test(artist)) {
    return { artist: '', title: candidate.trim() };
  }

  return { artist, title };
}
