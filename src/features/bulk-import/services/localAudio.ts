/* ============================================================
 * NodeFM Station — Local Audio Duration Inspection
 *
 * Best-effort local duration resolution for staging preview only.
 * This is not a publication transport and never leaves the row
 * draft. It degrades to null when the Web Audio API is unavailable,
 * the format cannot be decoded, or the conservative preflight policy
 * rejects an expensive whole-file decode.
 * ============================================================ */

import { MIB_BYTES } from '../limits';

/**
 * Whole-file Web Audio decode expands compressed audio into PCM and can
 * allocate an order of magnitude more memory than the source file. A
 * 50 MiB per-file cap keeps the fallback useful without allowing one
 * oversized or hostile file to become a browser memory bomb.
 */
export const BULK_IMPORT_LOCAL_DECODE_MAX_BYTES = 50 * MIB_BYTES;

export function shouldAttemptLocalAudioDecode(file: Pick<File, 'size'>): boolean {
  return file.size > 0 && file.size <= BULK_IMPORT_LOCAL_DECODE_MAX_BYTES;
}

export async function resolveLocalAudioDurationMs(
  file: File,
  options: { signal?: AbortSignal } = {},
): Promise<number | null> {
  if (typeof AudioContext === 'undefined' || !shouldAttemptLocalAudioDecode(file)) {
    return null;
  }

  const context = new AudioContext();

  try {
    if (options.signal?.aborted) return null;

    const buffer = await file.arrayBuffer();
    if (options.signal?.aborted) return null;

    const decoded = await context.decodeAudioData(buffer);
    if (options.signal?.aborted) return null;

    const durationSeconds = decoded.duration;

    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      return null;
    }

    return Math.round(durationSeconds * 1000);
  } catch {
    return null;
  } finally {
    await context.close().catch(() => undefined);
  }
}
