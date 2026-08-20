/* ============================================================
 * NodeFM Station — Secondary Taxonomy Memory
 *
 * Session-scoped learned Tags/Genres. This is intentionally
 * secondary to canonical Station Track metadata; it exists so a
 * successfully entered value can be suggested again immediately,
 * including in flows that do not write a Station Track yet (for
 * example listener submissions).
 * ============================================================ */

import {
  MAX_TAXONOMY_VALUE_LENGTH,
  mergeTaxonomySuggestions,
  splitTaxonomyValues,
} from './taxonomyService';

export type TaxonomyKind = 'genres' | 'tags';

export type TaxonomyMemory = {
  genres: string[];
  tags: string[];
};

const EMPTY_MEMORY: TaxonomyMemory = { genres: [], tags: [] };
const STORAGE_PREFIX = 'nodefm-taxonomy:';

function storageKey(scope: string): string {
  return `${STORAGE_PREFIX}${scope}`;
}

function isMemory(value: unknown): value is TaxonomyMemory {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<TaxonomyMemory>;
  return (
    Array.isArray(candidate.genres) &&
    candidate.genres.every((entry) => typeof entry === 'string') &&
    Array.isArray(candidate.tags) &&
    candidate.tags.every((entry) => typeof entry === 'string')
  );
}

function sanitizeMemory(value: unknown): TaxonomyMemory {
  if (!isMemory(value)) return { ...EMPTY_MEMORY };

  const genres = mergeTaxonomySuggestions([], value.genres)
    .filter((entry) => entry.length <= MAX_TAXONOMY_VALUE_LENGTH)
    .slice(0, 100);
  const tags = mergeTaxonomySuggestions([], value.tags)
    .filter((entry) => entry.length <= MAX_TAXONOMY_VALUE_LENGTH)
    .slice(0, 100);

  return { genres, tags };
}

export function loadTaxonomyMemory(scope: string): TaxonomyMemory {
  if (!scope.trim()) return { ...EMPTY_MEMORY };

  try {
    if (typeof window === 'undefined') return { ...EMPTY_MEMORY };
    const raw = window.sessionStorage.getItem(storageKey(scope));
    return raw ? sanitizeMemory(JSON.parse(raw)) : { ...EMPTY_MEMORY };
  } catch {
    return { ...EMPTY_MEMORY };
  }
}

export function saveTaxonomyMemory(scope: string, memory: TaxonomyMemory): void {
  if (!scope.trim()) return;

  try {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(storageKey(scope), JSON.stringify(sanitizeMemory(memory)));
  } catch {
    // Session storage is best-effort only.
  }
}

export function rememberTaxonomyValues(
  scope: string,
  kind: TaxonomyKind,
  rawValues: readonly string[],
): TaxonomyMemory {
  const memory = loadTaxonomyMemory(scope);
  const additions = splitTaxonomyValues(rawValues.join(','));
  const next: TaxonomyMemory = {
    ...memory,
    [kind]: mergeTaxonomySuggestions(memory[kind], additions),
  };

  saveTaxonomyMemory(scope, next);
  return next;
}

export function resetTaxonomyMemory(): void {
  // Intentionally does not enumerate sessionStorage keys; this test helper
  // only resets the module's in-memory consumers. Browser storage is managed
  // by load/save calls and is intentionally best-effort.
}
