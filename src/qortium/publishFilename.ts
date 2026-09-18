/* ============================================================
 * NodeFM Station — QDN Publish Filename Contract (Home 2.1)
 *
 * NodeFM publishes browser File objects through the Qortium bridge.
 * The filename handed to Home's publish-source staging is the
 * filename Home publishes, so NodeFM forwards the original name.
 *
 * Home 2.1 sanitizes the staged name itself — leaf-only, control
 * characters replaced, trailing dots/spaces trimmed, 180 characters
 * (`sanitizeHomeV2BlobFileName` in
 * `electron/home-v2-publish-blob-source.ts`) — and it keeps Unicode:
 * accented, Cyrillic, CJK and symbol characters survive staging.
 * That behavior is Home's issue #330 fix, shipped in Home
 * `v2.1.0-beta.11` (merge commit `11f50967`, PR #337).
 *
 * NodeFM therefore keeps only the input rules Home cannot be asked to
 * repair: a filename must be a single leaf name and must not carry
 * path or control characters. Unicode is never transliterated, hashed
 * or ASCII-normalized, because Home 2.1 and Core both accept it.
 * ============================================================ */

export type QdnPublishFilename = {
  /** The original user-visible filename, NFC-normalized and trimmed. */
  display: string;
  /** The filename handed to Home's publish-source staging. */
  staged: string;
};

const WINDOWS_DRIVE_PATH = /^[a-z]:[\\/]/i;

function hasControlOrDel(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);

    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }

  return false;
}

function assertSafeFilenameInput(filename: string): void {
  if (
    filename === '.' ||
    filename === '..' ||
    filename.startsWith('/') ||
    filename.startsWith('\\') ||
    filename.includes('/') ||
    filename.includes('\\') ||
    filename.includes('\u0000') ||
    hasControlOrDel(filename) ||
    WINDOWS_DRIVE_PATH.test(filename)
  ) {
    throw new Error(`Unsafe QDN publish filename: ${filename}`);
  }
}

/**
 * Resolve the filename NodeFM stages and publishes.
 *
 * The original name is preserved after NFC normalization and trimming,
 * including every Unicode character. Unsafe path/control input is
 * rejected instead of silently rewritten.
 */
export function resolveQdnPublishFilename(
  value: string | undefined,
  fallback = 'qdn-resource',
): QdnPublishFilename {
  const rawDisplay = (value ?? '').trim();

  if (!rawDisplay) {
    return { display: fallback, staged: fallback };
  }

  const display = rawDisplay.normalize('NFC');

  assertSafeFilenameInput(display);

  return { display, staged: display };
}

/** True when the filename can be staged and published without rewriting. */
export function isQdnPublishFilenameSafe(value: string): boolean {
  if (!value.trim()) {
    return false;
  }

  return resolveQdnPublishFilename(value).staged === value.trim();
}
