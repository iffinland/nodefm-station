/* ============================================================
 * NodeFM Station — Album Input
 *
 * Artist-aware optional Album suggestions. When the selected
 * Artist has known Album values, those are preferred; otherwise
 * the global existing Album vocabulary is still suggested. User
 * input is never silently rewritten.
 * ============================================================ */

import { MetadataAutocompleteInput } from './MetadataAutocompleteInput';
import { useMetadataIntelligence } from './metadataIntelligenceContext';

type AlbumInputProps = {
  value: string;
  onChange: (value: string) => void;
  artistValue: string;
  placeholder?: string;
};

export function AlbumInput({ value, onChange, artistValue, placeholder }: AlbumInputProps) {
  const { getAlbumsForArtist } = useMetadataIntelligence();
  const suggestions = getAlbumsForArtist(artistValue);

  return (
    <MetadataAutocompleteInput
      value={value}
      onChange={onChange}
      suggestions={suggestions}
      placeholder={placeholder}
      ariaLabel="Album"
    />
  );
}
