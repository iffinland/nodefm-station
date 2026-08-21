/* ============================================================
 * NodeFM Station — Bulk Import Row Editor
 *
 * One compact, editable staging row. Metadata entry reuses the
 * shared Artist/Title/Album/ReleaseDate and Taxonomy inputs from
 * Workflows C/D; there is no bulk-specific autocomplete here.
 * ============================================================ */

import { useEffect, useRef, useState } from 'react';
import { formatDurationMs } from '../../../utils/duration';
import { ArtistInput, AlbumInput, ReleaseDateInput, TitleInput } from '../../metadata-intelligence';
import { TaxonomyInput, getCanonicalTaxonomyValues, useTaxonomy } from '../../taxonomy';
import { getBulkImportRowDisplayStatus, getBulkImportRowValidation } from '../selectors';
import type { BulkImportMetadataField, BulkImportRow } from '../types';

type BulkImportRowEditorProps = {
  row: BulkImportRow;
  onSelect: (selected: boolean) => void;
  onRemove: () => void;
  onFieldChange: (field: BulkImportMetadataField, value: string | string[]) => void;
  onCoverSelected: (file: File) => void;
  onCoverRemove: () => void;
  onReselectSource: (file: File) => void;
};

export function BulkImportRowEditor({
  row,
  onSelect,
  onRemove,
  onFieldChange,
  onCoverSelected,
  onCoverRemove,
  onReselectSource,
}: BulkImportRowEditorProps) {
  const validation = getBulkImportRowValidation(row);
  const status = getBulkImportRowDisplayStatus(row);
  const { genres: genreSuggestions, tags: tagSuggestions } = useTaxonomy();

  const [genreText, setGenreText] = useState(row.metadata.genres.join(', '));
  const [tagText, setTagText] = useState(row.metadata.tags.join(', '));
  const genreFocusedRef = useRef(false);
  const tagFocusedRef = useRef(false);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const sourceInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!genreFocusedRef.current) {
      setGenreText(row.metadata.genres.join(', '));
    }
  }, [row.metadata.genres]);

  useEffect(() => {
    if (!tagFocusedRef.current) {
      setTagText(row.metadata.tags.join(', '));
    }
  }, [row.metadata.tags]);

  const handleGenreChange = (value: string) => {
    setGenreText(value);
    onFieldChange('genres', getCanonicalTaxonomyValues(value, genreSuggestions));
  };

  const handleTagChange = (value: string) => {
    setTagText(value);
    onFieldChange('tags', getCanonicalTaxonomyValues(value, tagSuggestions));
  };

  const sizeLabel = row.localSource
    ? `${(row.localSource.sizeBytes / (1024 * 1024)).toFixed(1)} MiB`
    : 'Unknown size';

  const statusLabel = {
    analyzing: 'Analyzing…',
    'source-missing': 'Audio file needs re-selection',
    'needs-attention': 'Needs attention',
    ready: 'Ready',
  }[status];

  return (
    <article className={`bulk-import-row bulk-import-row--${status}`}>
      <div className="bulk-import-row__topline">
        <label className="form-check bulk-import-row__select">
          <input
            type="checkbox"
            checked={row.selected}
            onChange={(event) => onSelect(event.target.checked)}
          />
          Include
        </label>
        <span className={`bulk-import-row__status bulk-import-row__status--${status}`}>
          {statusLabel}
        </span>
        <button
          className="button button--secondary bulk-import-row__remove"
          type="button"
          onClick={onRemove}
        >
          Remove
        </button>
      </div>

      <div className="bulk-import-row__source">
        <div className="bulk-import-row__source-info">
          <strong>{row.localSource?.fileName ?? 'No audio file'}</strong>
          <span>
            {sizeLabel}
            {row.durationMs !== null && row.durationMs > 0
              ? ` · ${formatDurationMs(row.durationMs)}`
              : ''}
          </span>
          {!row.audioSourceAvailable ? (
            <span className="bulk-import-row__warning">
              The original file is gone; re-select it.
            </span>
          ) : null}
          {row.extraction.error ? (
            <span className="bulk-import-row__warning">
              Metadata extraction failed, but the row is still editable.
            </span>
          ) : null}
          {row.audioSourceAvailable && (row.durationMs === null || row.durationMs <= 0) ? (
            <span className="bulk-import-row__warning">Duration could not be determined.</span>
          ) : null}
        </div>
        <button
          className="button button--secondary"
          type="button"
          onClick={() => sourceInputRef.current?.click()}
        >
          {row.audioSourceAvailable ? 'Replace audio' : 'Re-select audio'}
        </button>
        <input
          ref={sourceInputRef}
          type="file"
          accept="audio/*"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onReselectSource(file);
            event.target.value = '';
          }}
        />
      </div>

      <div className="bulk-import-row__grid">
        <label className="form-field bulk-import-row__field">
          Title
          <TitleInput
            value={row.metadata.title}
            onChange={(value) => onFieldChange('title', value)}
            artistValue={row.metadata.artist}
            placeholder="Track title"
          />
        </label>

        <label className="form-field bulk-import-row__field">
          Artist
          <ArtistInput
            value={row.metadata.artist}
            onChange={(value) => onFieldChange('artist', value)}
            placeholder="Artist name"
          />
        </label>

        <label className="form-field bulk-import-row__field">
          Album
          <AlbumInput
            value={row.metadata.album}
            onChange={(value) => onFieldChange('album', value)}
            artistValue={row.metadata.artist}
            placeholder="Optional album name"
          />
        </label>

        <label className="form-field bulk-import-row__field">
          Release date
          <ReleaseDateInput
            value={row.metadata.releaseDate}
            onChange={(value) => onFieldChange('releaseDate', value)}
            placeholder="1991-08-12"
          />
        </label>

        <label className="form-field bulk-import-row__field">
          Genres
          <span
            onFocusCapture={() => {
              genreFocusedRef.current = true;
            }}
            onBlurCapture={() => {
              genreFocusedRef.current = false;
            }}
          >
            <TaxonomyInput
              kind="genres"
              value={genreText}
              onChange={handleGenreChange}
              placeholder="Rock, Electronic, Jazz"
            />
          </span>
        </label>

        <label className="form-field bulk-import-row__field">
          Tags
          <span
            onFocusCapture={() => {
              tagFocusedRef.current = true;
            }}
            onBlurCapture={() => {
              tagFocusedRef.current = false;
            }}
          >
            <TaxonomyInput
              kind="tags"
              value={tagText}
              onChange={handleTagChange}
              placeholder="chill, upbeat, instrumental"
            />
          </span>
        </label>
      </div>

      <div className="bulk-import-row__cover">
        {row.cover?.previewUrl ? (
          <img
            src={row.cover.previewUrl}
            alt={`${row.metadata.title || row.localSource?.fileName || 'Track'} cover preview`}
            className="bulk-import-row__cover-preview"
          />
        ) : (
          <div className="bulk-import-row__cover-placeholder">🎵</div>
        )}
        <div className="bulk-import-row__cover-actions">
          <button
            className="button button--secondary"
            type="button"
            onClick={() => coverInputRef.current?.click()}
          >
            {row.cover ? 'Replace cover' : 'Add cover'}
          </button>
          {row.cover ? (
            <button className="button button--secondary" type="button" onClick={onCoverRemove}>
              Remove cover
            </button>
          ) : null}
        </div>
        <input
          ref={coverInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onCoverSelected(file);
            event.target.value = '';
          }}
        />
        {row.cover && !row.coverSourceAvailable ? (
          <p className="bulk-import-row__warning">
            Cover source is gone; re-select the cover or remove it.
          </p>
        ) : null}
      </div>

      {validation.missingRequiredFields.length > 0 ? (
        <p className="bulk-import-row__validation">
          Missing required: {validation.missingRequiredFields.join(', ')}
        </p>
      ) : null}
      {validation.hasInvalidReleaseDate ? (
        <p className="bulk-import-row__validation">
          Release date must use YYYY, YYYY-MM, or YYYY-MM-DD.
        </p>
      ) : null}
    </article>
  );
}
