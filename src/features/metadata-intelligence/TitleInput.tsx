/* ============================================================
 * NodeFM Station — Title Input
 *
 * Artist-aware Title suggestions. Suggestions are scoped to the
 * currently selected/entered Artist, and identical Titles under
 * different Artists remain independent.
 * ============================================================ */

import { MetadataAutocompleteInput } from './MetadataAutocompleteInput';
import { useMetadataIntelligence } from './metadataIntelligenceContext';

type TitleInputProps = {
  value: string;
  onChange: (value: string) => void;
  artistValue: string;
  placeholder?: string;
};

export function TitleInput({ value, onChange, artistValue, placeholder }: TitleInputProps) {
  const { getTitlesForArtist } = useMetadataIntelligence();
  const suggestions = getTitlesForArtist(artistValue);

  return (
    <MetadataAutocompleteInput
      value={value}
      onChange={onChange}
      suggestions={suggestions}
      placeholder={placeholder}
      ariaLabel="Title"
    />
  );
}
