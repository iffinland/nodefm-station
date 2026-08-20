/* ============================================================
 * NodeFM Station — QDN Publish Filename Normalization
 *
 * NodeFM publishes browser File objects through the Qortium bridge.
 * The live Core contract currently rejects filenames that are not
 * representable in the node's filesystem charset, so NodeFM must keep
 * the QDN filename field transport-safe while preserving the original
 * filename for display in NodeFM-owned metadata.
 *
 * This module intentionally distinguishes:
 *   - unsafe filesystem/path input -> reject
 *   - Unicode filename -> transport-safe ASCII, original preserved
 *   - normal ASCII filename -> unchanged
 * ============================================================ */

export type QdnPublishFilename = {
  /** The original user-visible filename, NFC-normalized and trimmed. */
  display: string;
  /** The ASCII-only filename safe to hand to the QDN bridge/Core. */
  transport: string;
};

const PRINTABLE_ASCII = /^[\x20-\x7e]+$/;
const WINDOWS_DRIVE_PATH = /^[a-z]:[\\/]/i;

function stableHash(value: string): string {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}

function getSafeExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');

  if (lastDot <= 0 || lastDot === filename.length - 1) {
    return 'bin';
  }

  const extension = filename.slice(lastDot + 1);

  if (/^[a-z0-9]{1,10}$/i.test(extension)) {
    return extension.toLowerCase();
  }

  return 'bin';
}

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
 * Normalize a browser filename for QDN publication.
 *
 * Normal ASCII filenames are preserved unchanged. Filenames containing
 * Unicode or other non-ASCII characters are kept for display but replaced
 * with a deterministic ASCII transport filename, because the current Core
 * contract rejects non-ASCII filenames.
 */
export function normalizeQdnPublishFilename(
  value: string | undefined,
  fallback = 'qdn-resource',
): QdnPublishFilename {
  const rawDisplay = (value ?? '').trim();

  if (!rawDisplay) {
    return {
      display: fallback,
      transport: fallback,
    };
  }

  const display = rawDisplay.normalize('NFC');

  assertSafeFilenameInput(display);

  if (PRINTABLE_ASCII.test(display)) {
    return {
      display,
      transport: display,
    };
  }

  const extension = getSafeExtension(display);

  return {
    display,
    transport: `nodefm-upload-${stableHash(display)}.${extension}`,
  };
}

/**
 * True when a filename can be passed to the current QDN/Core filename path
 * without normalization.
 */
export function isQdnTransportFilenameSafe(value: string): boolean {
  if (!value.trim()) {
    return false;
  }

  return normalizeQdnPublishFilename(value).transport === value.trim();
}
