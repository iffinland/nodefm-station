/* ============================================================
 * NodeFM Station — Taxonomy Service
 *
 * Unified Tags/Genres normalization, deduplication, canonical
 * display resolution, and suggestion ranking.
 *
 * This is a deliberate adaptation of the production Blogs
 * taxonomy service:
 *   /projects/Blogs/src/services/blog/taxonomyService.ts
 *
 * The Blogs implementation was chosen as the reference because it
 * is the owner's existing production Tags/Genres-style UX. The
 * NodeFM version preserves the same behavior while enforcing the
 * verified Qortium metadata limits:
 *   - at most 5 values;
 *   - at most 20 UTF-16 code units per value.
 * ============================================================ */

export const MAX_TAXONOMY_VALUES = 5;
export const MAX_TAXONOMY_VALUE_LENGTH = 20;

/** Trim and collapse internal whitespace. Does NOT lowercase; display casing is preserved. */
export function normalizeTaxonomyValue(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/** Case-folded key used for matching and duplicate prevention. */
export function taxonomyKey(value: string): string {
  return normalizeTaxonomyValue(value).toLowerCase();
}

/**
 * Split comma-separated input into clean taxonomy values.
 * Values are trimmed, internal whitespace is collapsed, empty values
 * are dropped, values are capped to the QDN metadata limits, and
 * case-insensitive duplicates are removed while preserving the first
 * canonical display form.
 */
export function splitTaxonomyValues(value: string): string[] {
  const seen = new Set<string>();
  const values: string[] = [];

  for (const raw of value.split(',')) {
    const normalized = normalizeTaxonomyValue(raw);
    if (!normalized) continue;
    if (normalized.length > MAX_TAXONOMY_VALUE_LENGTH) continue;

    const key = taxonomyKey(normalized);
    if (seen.has(key)) continue;

    seen.add(key);
    values.push(normalized);

    if (values.length >= MAX_TAXONOMY_VALUES) break;
  }

  return values;
}

/**
 * Resolve one entered value to a canonical display value. If a
 * case-insensitive match already exists in the suggestion pool, the
 * existing display casing is preserved; otherwise the normalized new
 * value is used.
 */
export function getCanonicalTaxonomyValue(value: string, suggestions: readonly string[]): string {
  const normalized = normalizeTaxonomyValue(value);
  if (!normalized) return '';
  const key = taxonomyKey(normalized);
  return suggestions.find((candidate) => taxonomyKey(candidate) === key) ?? normalized;
}

/**
 * Resolve comma-separated input into canonical values, deduplicating
 * case-insensitively and applying the verified QDN limits.
 */
export function getCanonicalTaxonomyValues(
  value: string,
  suggestions: readonly string[],
): string[] {
  const seen = new Set<string>();
  const values: string[] = [];

  for (const raw of splitTaxonomyValues(value)) {
    const canonical = getCanonicalTaxonomyValue(raw, suggestions);
    if (!canonical || canonical.length > MAX_TAXONOMY_VALUE_LENGTH) continue;

    const key = taxonomyKey(canonical);
    if (seen.has(key)) continue;

    seen.add(key);
    values.push(canonical);

    if (values.length >= MAX_TAXONOMY_VALUES) break;
  }

  return values;
}

export type RankedSuggestion = {
  value: string;
  rank: number;
};

/**
 * Filter and rank a suggestion pool against the current query token.
 * Ranking: exact key > prefix > word-prefix > substring > alphabetic.
 */
export function rankSuggestions(
  query: string,
  suggestions: readonly string[],
  excludeKeys?: ReadonlySet<string>,
  limit = 12,
): RankedSuggestion[] {
  const queryKey = taxonomyKey(query);
  const source = queryKey ? suggestions : suggestions.slice(0, limit);
  const results: RankedSuggestion[] = [];

  for (const candidate of source) {
    const key = taxonomyKey(candidate);
    if (excludeKeys?.has(key)) continue;

    if (!queryKey) {
      results.push({ value: candidate, rank: 100 });
      continue;
    }

    let rank = 100;
    if (key === queryKey) rank = 0;
    else if (key.startsWith(queryKey)) rank = 1;
    else if (key.split(/\s+/).some((word) => word.startsWith(queryKey))) rank = 2;
    else if (key.includes(queryKey)) rank = 3;
    else continue;

    results.push({ value: candidate, rank });
  }

  return results
    .sort((left, right) => left.rank - right.rank || left.value.localeCompare(right.value))
    .slice(0, limit);
}

/**
 * Merge already-normalized values into a unique, alphabetically sorted
 * suggestion pool. Used for canonical values read from Station Tracks
 * and for secondary session-level learned values.
 */
export function mergeTaxonomySuggestions(
  current: readonly string[],
  additions: readonly string[],
): string[] {
  const map = new Map<string, string>(
    current
      .map((value) => normalizeTaxonomyValue(value))
      .filter(Boolean)
      .filter((value) => value.length <= MAX_TAXONOMY_VALUE_LENGTH)
      .map((value) => [taxonomyKey(value), value]),
  );

  for (const addition of additions) {
    const normalized = normalizeTaxonomyValue(addition);
    if (!normalized || normalized.length > MAX_TAXONOMY_VALUE_LENGTH) continue;
    const key = taxonomyKey(normalized);
    if (!map.has(key)) map.set(key, normalized);
  }

  return [...map.values()].sort((left, right) => left.localeCompare(right));
}
