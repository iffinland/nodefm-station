export { MetadataIntelligenceProvider } from './MetadataIntelligenceProvider';
export { ArtistInput } from './ArtistInput';
export { TitleInput } from './TitleInput';
export { useMetadataIntelligence } from './metadataIntelligenceContext';
export type { CanonicalArtist, CanonicalTitle, MetadataIndex } from './metadataIntelligence';
export {
  buildMetadataIndex,
  getArtistDisplayValues,
  getArtistSuggestions,
  getArtistTitles,
  getCanonicalArtistDisplayValue,
  getCanonicalTitleDisplayValue,
  getTitleDisplayValues,
  getTitleSuggestionsForArtist,
  metadataValueKey,
  normalizeMetadataValue,
} from './metadataIntelligence';
