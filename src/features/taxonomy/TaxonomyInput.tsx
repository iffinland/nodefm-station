/* ============================================================
 * NodeFM Station — Unified Taxonomy Input
 *
 * One reusable Tags/Genres input used by every NodeFM form that
 * accepts comma-separated taxonomy values. It offers ranked
 * suggestions while typing, permits free-value creation, excludes
 * already-selected values, and supports keyboard navigation.
 *
 * UX adapted from Blogs TaxonomyTagInput:
 *   /projects/Blogs/src/App.tsx
 * ============================================================ */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTaxonomy } from './taxonomyContext';
import {
  MAX_TAXONOMY_VALUE_LENGTH,
  normalizeTaxonomyValue,
  rankSuggestions,
  splitTaxonomyValues,
  taxonomyKey,
} from './taxonomyService';
import type { TaxonomyKind } from './taxonomyMemory';

const SUGGESTION_LIMIT = 12;

type TaxonomyInputState = {
  prefix: string;
  selected: Set<string>;
  token: string;
};

function getInputState(value: string): TaxonomyInputState {
  const parts = value.split(',');
  const rawToken = parts[parts.length - 1] ?? '';
  const token = normalizeTaxonomyValue(rawToken);
  const prefix = parts.slice(0, -1).join(',').trim();
  const selected = new Set(
    parts
      .slice(0, -1)
      .map((part) => taxonomyKey(part))
      .filter(Boolean),
  );

  return { prefix, selected, token };
}

type TaxonomyInputProps = {
  kind: TaxonomyKind;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
};

export function TaxonomyInput({ kind, value, onChange, placeholder }: TaxonomyInputProps) {
  const taxonomy = useTaxonomy();
  const suggestions = kind === 'genres' ? taxonomy.genres : taxonomy.tags;
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { prefix, selected, token } = useMemo(() => getInputState(value), [value]);
  const tokenKey = taxonomyKey(token);

  const ranked = useMemo(() => {
    return rankSuggestions(tokenKey, suggestions, selected, SUGGESTION_LIMIT).map(
      (entry) => entry.value,
    );
  }, [selected, suggestions, tokenKey]);

  const exactMatchExists = tokenKey
    ? suggestions.some((suggestion) => taxonomyKey(suggestion) === tokenKey)
    : false;
  const canCreateNew = token.length > 0 && token.length <= MAX_TAXONOMY_VALUE_LENGTH;
  const showDropdown = isOpen && tokenKey.length > 0;

  useEffect(() => {
    if (!isOpen) return;

    const handleOutsideClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setHighlightIndex(-1);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isOpen]);

  const applySuggestion = (suggestion: string) => {
    onChange(prefix ? `${prefix}, ${suggestion}` : suggestion);
    setIsOpen(false);
    setHighlightIndex(-1);
    inputRef.current?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!showDropdown) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    const itemCount = ranked.length + (exactMatchExists || !canCreateNew ? 0 : 1);

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setHighlightIndex((current) => (current < itemCount - 1 ? current + 1 : 0));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setHighlightIndex((current) => (current > 0 ? current - 1 : itemCount - 1));
        break;
      case 'Enter':
        event.preventDefault();
        if (highlightIndex >= 0 && highlightIndex < ranked.length) {
          applySuggestion(ranked[highlightIndex]);
        } else if (highlightIndex === ranked.length && !exactMatchExists && canCreateNew) {
          applySuggestion(token);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        setHighlightIndex(-1);
        break;
      case 'Backspace':
        if (!token && selected.size > 0) {
          const parts = splitTaxonomyValues(value);
          parts.pop();
          onChange(parts.join(', '));
        }
        break;
    }
  };

  return (
    <div className="taxonomy-field" ref={containerRef}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setIsOpen(true);
          setHighlightIndex(-1);
        }}
        onFocus={() => setIsOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={showDropdown}
        aria-label={kind === 'genres' ? 'Genres' : 'Tags'}
      />
      {showDropdown ? (
        <div className="taxonomy-suggestions" role="listbox">
          {ranked.map((suggestion, index) => (
            <button
              key={suggestion}
              type="button"
              className={`taxonomy-suggestion-item${index === highlightIndex ? ' highlighted' : ''}`}
              onClick={() => applySuggestion(suggestion)}
              onMouseEnter={() => setHighlightIndex(index)}
              role="option"
              aria-selected={index === highlightIndex}
            >
              {suggestion}
            </button>
          ))}
          {!exactMatchExists && canCreateNew ? (
            <button
              type="button"
              className={`taxonomy-suggestion-item taxonomy-create-new${
                highlightIndex === ranked.length ? ' highlighted' : ''
              }`}
              onClick={() => applySuggestion(token)}
              onMouseEnter={() => setHighlightIndex(ranked.length)}
              role="option"
              aria-selected={highlightIndex === ranked.length}
            >
              Create new “{token}”
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
