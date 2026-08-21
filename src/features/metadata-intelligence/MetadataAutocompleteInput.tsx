/* ============================================================
 * NodeFM Station — Metadata Autocomplete Input
 *
 * One role-neutral, single-value autocomplete primitive shared by
 * Artist and Title inputs. It ranks suggestions while typing,
 * permits free-value creation, applies canonical display values
 * only on explicit selection, and supports keyboard navigation.
 *
 * This is deliberately distinct from TaxonomyInput: Artist and
 * Title are single values and do not share Tags/Genres limits.
 * ============================================================ */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { rankSuggestions } from '../taxonomy/taxonomyService';
import { metadataValueKey, normalizeMetadataValue } from './metadataIntelligence';

const SUGGESTION_LIMIT = 12;

type MetadataAutocompleteInputProps = {
  value: string;
  onChange: (value: string) => void;
  suggestions: readonly string[];
  placeholder?: string;
  ariaLabel?: string;
};

export function MetadataAutocompleteInput({
  value,
  onChange,
  suggestions,
  placeholder,
  ariaLabel,
}: MetadataAutocompleteInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const token = useMemo(() => normalizeMetadataValue(value), [value]);
  const tokenKey = metadataValueKey(token);

  const ranked = useMemo(
    () =>
      rankSuggestions(tokenKey, suggestions, undefined, SUGGESTION_LIMIT).map(
        (entry) => entry.value,
      ),
    [suggestions, tokenKey],
  );

  const exactMatchExists = tokenKey
    ? suggestions.some((suggestion) => metadataValueKey(suggestion) === tokenKey)
    : false;
  const canCreateNew = token.length > 0;
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
    onChange(suggestion);
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
    }
  };

  return (
    <div className="metadata-field" ref={containerRef}>
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
        aria-label={ariaLabel}
      />
      {showDropdown ? (
        <div className="metadata-suggestions" role="listbox">
          {ranked.map((suggestion, index) => (
            <button
              key={suggestion}
              type="button"
              className={`metadata-suggestion-item${
                index === highlightIndex ? ' highlighted' : ''
              }`}
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
              className={`metadata-suggestion-item metadata-create-new${
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
