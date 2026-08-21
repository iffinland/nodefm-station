import { describe, expect, it } from 'vitest';

const surfaceModules = import.meta.glob(
  [
    '../library/components/UploadFlow.tsx',
    '../library/components/AddQdnFlow.tsx',
    '../library/components/TrackEditModal.tsx',
    '../listener-submissions/components/SubmitMusicForm.tsx',
  ],
  {
    query: '?raw',
    import: 'default',
    eager: true,
  },
);

const surfaceSources = Object.values(surfaceModules) as string[];

describe('metadata intelligence reuse surfaces', () => {
  it('keeps Admin and Listener metadata entry on the same shared Artist/Title components', () => {
    expect(surfaceSources.length).toBe(4);

    for (const source of surfaceSources) {
      expect(source).toContain("from '../../metadata-intelligence'");
      expect(source).toContain('<ArtistInput');
      expect(source).toContain('<TitleInput');
      expect(source).toContain('<AlbumInput');
      expect(source).toContain('<ReleaseDateInput');
    }
  });

  it('does not introduce owner-specific parallel autocomplete implementations', () => {
    for (const source of surfaceSources) {
      expect(source).not.toContain('AdminArtistAutocomplete');
      expect(source).not.toContain('ListenerArtistAutocomplete');
      expect(source).not.toContain('BulkArtistAutocomplete');
      expect(source).not.toContain('AdminTitleAutocomplete');
      expect(source).not.toContain('ListenerTitleAutocomplete');
      expect(source).not.toContain('AdminAlbumAutocomplete');
      expect(source).not.toContain('ListenerAlbumAutocomplete');
      expect(source).not.toContain('BulkAlbumAutocomplete');
    }
  });
});
