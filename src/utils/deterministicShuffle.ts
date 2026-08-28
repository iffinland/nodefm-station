/* ============================================================
 * NodeFM Station — Deterministic Shuffle Utilities
 *
 * Stable, cross-runtime seeded PRNG + Fisher-Yates shuffle.
 * No wall clock, no Math.random(), and no local state.
 * ============================================================ */

/**
 * FNV-1a over JavaScript UTF-16 code units. This is intentionally kept
 * simple and portable rather than using TextEncoder, so the same result
 * is produced by every supported browser/runtime.
 */
export function fnv1aHash(value: string): number {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}

/** Convert a hash to a non-negative 32-bit PRNG seed. */
export function stringToSeed(value: string): number {
  return fnv1aHash(value);
}

/** A small, deterministic mulberry32 PRNG. */
export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let result = state;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Build a canonical seed string from stable domain inputs. */
export function buildCanonicalSeed(parts: readonly unknown[]): string {
  return parts.map((part) => String(part)).join('\u0000');
}

/**
 * Unbiased Fisher-Yates shuffle using a provided random source.
 * The returned array is always a new array.
 */
export function shuffleWithRandom<T>(values: readonly T[], random: () => number): T[] {
  const result = [...values];

  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const current = result[index];
    result[index] = result[swapIndex];
    result[swapIndex] = current;
  }

  return result;
}

/**
 * Deterministic Fisher-Yates shuffle from a string or numeric seed.
 * Equal input yields the exact same output order.
 */
export function shuffleDeterministic<T>(values: readonly T[], seed: string | number): T[] {
  const numericSeed = typeof seed === 'number' ? seed : stringToSeed(seed);
  return shuffleWithRandom(values, createSeededRandom(numericSeed));
}

/**
 * Non-deterministic Fisher-Yates shuffle for local UI actions such as
 * admin playlist draft reordering. Prefers crypto randomness when
 * available, falling back to Math.random().
 */
export function shuffleArray<T>(values: readonly T[]): T[] {
  const random = createNonDeterministicRandom();
  return shuffleWithRandom(values, random);
}

function createNonDeterministicRandom(): () => number {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const buffer = new Uint32Array(1);

    return () => {
      crypto.getRandomValues(buffer);
      return buffer[0] / 4_294_967_296;
    };
  }

  return Math.random;
}

/**
 * Rotate an array so the item at `startIndex` becomes the first item:
 * [A,B,C,D,E] with startIndex 2 -> [C,D,E,A,B].
 */
export function rotateArray<T>(values: readonly T[], startIndex: number): T[] {
  if (values.length === 0) {
    return [];
  }

  const normalized = ((startIndex % values.length) + values.length) % values.length;
  return [...values.slice(normalized), ...values.slice(0, normalized)];
}
