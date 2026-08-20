/* ============================================================
 * NodeFM Station — Track Edit Modal
 *
 * Edit station track metadata.
 * ============================================================ */

import { useState } from 'react';
import { Modal } from '../../../components/Modal';
import type { Track } from '../../../types/domain';
import { useLibrary } from '../../../hooks/useLibrary';
import { useStationIdentity } from '../../station';
import { TaxonomyInput, useTaxonomy, getCanonicalTaxonomyValues } from '../../taxonomy';
import { TrackCover } from './TrackCover';
import { publishAndUpdateTrackCover, readCoverFile } from '../services/coverService';

type Props = {
  track: Track;
  onClose: () => void;
};

export function TrackEditModal({ track, onClose }: Props) {
  const { editTrack } = useLibrary();
  const { publisherName } = useStationIdentity();
  const { remember, genres: genreSuggestions, tags: tagSuggestions } = useTaxonomy();
  const [title, setTitle] = useState(track.title);
  const [artist, setArtist] = useState(track.artist ?? '');
  const [description, setDescription] = useState(track.description ?? '');
  const [genres, setGenres] = useState(track.genres?.join(', ') ?? '');
  const [tags, setTags] = useState(track.tags?.join(', ') ?? '');
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverBase64, setCoverBase64] = useState<string | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [removeCover, setRemoveCover] = useState(false);
  const [saving, setSaving] = useState(false);
  const [coverPublishing, setCoverPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCoverSelected = async (file: File) => {
    try {
      const cover = await readCoverFile(file);
      setCoverFile(file);
      setCoverBase64(cover.data64);
      setCoverPreview(cover.dataUrl);
      setRemoveCover(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read cover image.');
    }
  };

  const handleRemoveCover = () => {
    setCoverFile(null);
    setCoverBase64(null);
    setCoverPreview(null);
    setRemoveCover(true);
    setError(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    try {
      const shouldRemoveCover = removeCover && !coverFile;

      if (coverFile) {
        if (!publisherName) {
          throw new Error('A registered Qortium name is required to publish a cover.');
        }

        if (!coverBase64) {
          throw new Error('Cover image data is not available.');
        }

        setCoverPublishing(true);
        try {
          await publishAndUpdateTrackCover({
            trackId: track.trackId,
            title: title || track.title,
            publisherName,
            file: coverFile,
            data64: coverBase64,
            metadata: {
              title: title || track.title,
              artist: artist || undefined,
              description: description || undefined,
              genres: genres.trim()
                ? getCanonicalTaxonomyValues(genres, genreSuggestions)
                : undefined,
              tags: tags.trim() ? getCanonicalTaxonomyValues(tags, tagSuggestions) : undefined,
            },
          });
        } catch (err) {
          throw new Error(
            `Cover publication failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
          );
        } finally {
          setCoverPublishing(false);
        }
      }

      if (!coverFile) {
        await editTrack(track.trackId, {
          title: title || track.title,
          artist: artist || undefined,
          description: description || undefined,
          genres: genres.trim() ? getCanonicalTaxonomyValues(genres, genreSuggestions) : undefined,
          tags: tags.trim() ? getCanonicalTaxonomyValues(tags, tagSuggestions) : undefined,
          ...(shouldRemoveCover ? { removeCover: true } : {}),
        });
      }
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

      <div className="form-field">
        <label>Cover Image</label>
        <div className="upload-flow__cover-preview-wrap">
          {coverPreview ? (
            <img
              src={coverPreview}
              alt="New cover preview"
              className="upload-flow__cover-preview"
            />
          ) : removeCover ? (
            <span className="upload-flow__cover-removed">Cover will be removed</span>
          ) : (
            <TrackCover
              cover={track.cover}
              placeholder={<div className="track-card__cover-placeholder">🎵</div>}
              alt={`${track.title} cover`}
            />
          )}
        </div>
        <div className="upload-flow__cover-actions">
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleCoverSelected(file);
            }}
          />
          {track.cover && (
            <button className="button button--secondary" type="button" onClick={handleRemoveCover}>
              Remove Cover
            </button>
          )}
        </div>
      </div>

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
          disabled={saving || coverPublishing || !title.trim()}
        >
          {coverPublishing ? 'Publishing cover…' : saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Modal>
  );
}
