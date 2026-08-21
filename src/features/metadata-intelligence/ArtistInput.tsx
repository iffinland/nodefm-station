/* ============================================================
 * NodeFM Station — Artist Input
 *
 * Thin role-neutral surface over the shared metadata index.
 * Existing canonical Artist values are suggested, but user input
 * is never silently rewritten.
 * ============================================================ */

import { MetadataAutocompleteInput } from './MetadataAutocompleteInput';
import { useMetadataIntelligence } from './metadataIntelligenceContext';

type ArtistInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
};

export function ArtistInput({ value, onChange, placeholder }: ArtistInputProps) {
  const { artists } = useMetadataIntelligence();

  return (
    <MetadataAutocompleteInput
      value={value}
      onChange={onChange}
      suggestions={artists}
      placeholder={placeholder}
      ariaLabel="Artist"
    />
  );
}
