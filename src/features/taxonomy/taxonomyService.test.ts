import { describe, expect, it } from 'vitest';
import {
  MAX_TAXONOMY_VALUE_LENGTH,
  MAX_TAXONOMY_VALUES,
  getCanonicalTaxonomyValue,
  getCanonicalTaxonomyValues,
  mergeTaxonomySuggestions,
  normalizeTaxonomyValue,
  rankSuggestions,
  splitTaxonomyValues,
  taxonomyKey,
} from './taxonomyService';

describe('taxonomy normalization', () => {
  it('trims and collapses whitespace without changing display casing', () => {
    expect(normalizeTaxonomyValue('  electronic  ')).toBe('electronic');
    expect(normalizeTaxonomyValue('Rock   n  Roll')).toBe('Rock n Roll');
  });

  it('keeps canonical casing for Rock/rock/ROCK keys', () => {
    expect(taxonomyKey('Rock')).toBe('rock');
    expect(taxonomyKey('rock')).toBe('rock');
    expect(taxonomyKey('ROCK')).toBe('rock');
  });
});

describe('taxonomy value splitting', () => {
  it('splits and trims comma-separated values', () => {
    expect(splitTaxonomyValues(' Rock , electronic ,  Jazz ')).toEqual([
      'Rock',
      'electronic',
      'Jazz',
    ]);
  });

  it('deduplicates case-insensitively and preserves the first form', () => {
    expect(splitTaxonomyValues('rock, ROCK, Rock')).toEqual(['rock']);
  });

  it('caps the number of values at the QDN metadata limit', () => {
    expect(splitTaxonomyValues('a, b, c, d, e, f')).toHaveLength(MAX_TAXONOMY_VALUES);
  });

  it('drops values that exceed the QDN tag length limit', () => {
    const tooLong = 'x'.repeat(MAX_TAXONOMY_VALUE_LENGTH + 1);
    expect(splitTaxonomyValues(`Rock, ${tooLong}`)).toEqual(['Rock']);
  });
});

describe('canonical taxonomy resolution', () => {
  const suggestions = ['Rock', 'Electronic', 'Home & Garden'];

  it('resolves entered casing/whitespace to existing canonical display form', () => {
    expect(getCanonicalTaxonomyValue(' rock ', suggestions)).toBe('Rock');
    expect(getCanonicalTaxonomyValue('ELECTRONIC', suggestions)).toBe('Electronic');
  });

  it('keeps a genuinely new value', () => {
    expect(getCanonicalTaxonomyValue('Ambient', suggestions)).toBe('Ambient');
  });

  it('produces multiple canonical values without casing duplicates', () => {
    expect(getCanonicalTaxonomyValues('rock, ELECTRONIC, Ambient', suggestions)).toEqual([
      'Rock',
      'Electronic',
      'Ambient',
    ]);
  });
});

describe('suggestion ranking', () => {
  const suggestions = ['Art', 'Artificial', 'Earth Art', 'Chart'];

  it('ranks exact, prefix, and substring matches in the expected order', () => {
    expect(rankSuggestions('art', suggestions).map((entry) => entry.value)).toEqual([
      'Art',
      'Artificial',
      'Earth Art',
      'Chart',
    ]);
  });

  it('excludes already-selected values', () => {
    const result = rankSuggestions('a', suggestions, new Set(['art', 'artificial']));
    expect(result.every((entry) => !['Art', 'Artificial'].includes(entry.value))).toBe(true);
  });
});

describe('suggestion merging', () => {
  it('preserves the first casing and sorts alphabetically', () => {
    expect(mergeTaxonomySuggestions(['Rock', 'Jazz'], ['rock', 'Ambient', 'JAZZ'])).toEqual([
      'Ambient',
      'Jazz',
      'Rock',
    ]);
  });
});
