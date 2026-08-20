/* ============================================================
 * NodeFM Station — Track Edit Modal
 *
 * Edit station track metadata.
 * ============================================================ */

import { useState } from 'react';
import { Modal } from '../../../components/Modal';
import type { Track } from '../../../types/domain';
import { useLibrary } from '../../../hooks/useLibrary';
import { TaxonomyInput, useTaxonomy, getCanonicalTaxonomyValues } from '../../taxonomy';

type Props = {
  track: Track;
  onClose: () => void;
};

export function TrackEditModal({ track, onClose }: Props) {
  const { editTrack } = useLibrary();
  const { remember, genres: genreSuggestions, tags: tagSuggestions } = useTaxonomy();
  const [title, setTitle] = useState(track.title);
  const [artist, setArtist] = useState(track.artist ?? '');
  const [description, setDescription] = useState(track.description ?? '');
  const [genres, setGenres] = useState(track.genres?.join(', ') ?? '');
  const [tags, setTags] = useState(track.tags?.join(', ') ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    try {
      await editTrack(track.trackId, {
        title: title || track.title,
        artist: artist || undefined,
        description: description || undefined,
        genres: genres.trim() ? getCanonicalTaxonomyValues(genres, genreSuggestions) : undefined,
        tags: tags.trim() ? getCanonicalTaxonomyValues(tags, tagSuggestions) : undefined,
      });
      remember('genres', getCanonicalTaxonomyValues(genres, genreSuggestions));
      remember('tags', getCanonicalTaxonomyValues(tags, tagSuggestions));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save track.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Edit Track" onClose={onClose}>
      <label className="form-field">
        Title
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>

      <label className="form-field">
        Artist
        <input type="text" value={artist} onChange={(e) => setArtist(e.target.value)} />
      </label>

      <label className="form-field">
        Description
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
      </label>

      <label className="form-field">
        Genres
        <TaxonomyInput
          kind="genres"
          value={genres}
          onChange={setGenres}
          placeholder="Rock, Electronic"
        />
      </label>

      <label className="form-field">
        Tags
        <TaxonomyInput
          kind="tags"
          value={tags}
          onChange={setTags}
          placeholder="chill, upbeat, instrumental"
        />
      </label>

      {error && <p className="form-error">{error}</p>}

      <div className="form-actions">
        <button className="button button--secondary" type="button" onClick={onClose}>
          Cancel
        </button>
        <button
          className="button button--primary"
          type="button"
          onClick={handleSave}
          disabled={saving || !title.trim()}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Modal>
  );
}
