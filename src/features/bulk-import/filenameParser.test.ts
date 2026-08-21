import { describe, expect, it } from 'vitest';
import { parseArtistTitleFromFilename } from './filenameParser';

describe('parseArtistTitleFromFilename', () => {
  it('parses Artist - Title with a plain extension', () => {
    expect(parseArtistTitleFromFilename('Pink Floyd - Time.mp3')).toEqual({
      artist: 'Pink Floyd',
      title: 'Time',
    });
  });

  it('parses en dash and em dash separators', () => {
    expect(parseArtistTitleFromFilename('Pink Floyd – Time.opus')).toEqual({
      artist: 'Pink Floyd',
      title: 'Time',
    });
    expect(parseArtistTitleFromFilename('Pink Floyd — Time.flac')).toEqual({
      artist: 'Pink Floyd',
      title: 'Time',
    });
  });

  it('does not split on an unhyphenated hyphen inside Artist or Title', () => {
    expect(parseArtistTitleFromFilename('Jean-Michel Jarre - Oxygene.mp3')).toEqual({
      artist: 'Jean-Michel Jarre',
      title: 'Oxygene',
    });
    expect(parseArtistTitleFromFilename('AC/DC - Back-In-Black.mp3')).toEqual({
      artist: 'AC/DC',
      title: 'Back-In-Black',
    });
  });

  it('uses the stem as Title when no safe Artist/Title split exists', () => {
    expect(parseArtistTitleFromFilename('Untitled Track.wav')).toEqual({
      artist: '',
      title: 'Untitled Track',
    });
  });

  it('strips only a recognized audio extension', () => {
    expect(parseArtistTitleFromFilename('Artist.Title - Track.Name.mp3')).toEqual({
      artist: 'Artist.Title',
      title: 'Track.Name',
    });
    expect(parseArtistTitleFromFilename('.hidden')).toEqual({ artist: '', title: '.hidden' });
    expect(parseArtistTitleFromFilename('Artist.Title')).toEqual({
      artist: '',
      title: 'Artist.Title',
    });
    expect(parseArtistTitleFromFilename('Artist - Title.final.mix.flac')).toEqual({
      artist: 'Artist',
      title: 'Title.final.mix',
    });
  });

  it('recognizes a leading track-number prefix before Artist/Title', () => {
    expect(parseArtistTitleFromFilename('01 - Artist - Title.mp3')).toEqual({
      artist: 'Artist',
      title: 'Title',
    });
    expect(parseArtistTitleFromFilename('01. Artist - Title.mp3')).toEqual({
      artist: 'Artist',
      title: 'Title',
    });
  });

  it('does not treat a year-like four digit prefix as a track number', () => {
    expect(parseArtistTitleFromFilename('2001 - A Space Odyssey.mp3')).toEqual({
      artist: '',
      title: '2001 - A Space Odyssey',
    });
  });

  it('handles stray leading and trailing separators without inventing Artist', () => {
    expect(parseArtistTitleFromFilename('- Title.mp3')).toEqual({
      artist: '',
      title: 'Title',
    });
    expect(parseArtistTitleFromFilename(' - Only A Title.mp3')).toEqual({
      artist: '',
      title: 'Only A Title',
    });
    expect(parseArtistTitleFromFilename('Artist -.mp3')).toEqual({
      artist: '',
      title: 'Artist',
    });
  });

  it('preserves remix suffixes and Unicode names', () => {
    expect(parseArtistTitleFromFilename('Artist - Title (Remix).mp3')).toEqual({
      artist: 'Artist',
      title: 'Title (Remix)',
    });
    expect(parseArtistTitleFromFilename('アーティスト - タイトル.mp3')).toEqual({
      artist: 'アーティスト',
      title: 'タイトル',
    });
  });

  it('returns empty values for an empty filename', () => {
    expect(parseArtistTitleFromFilename('')).toEqual({ artist: '', title: '' });
    expect(parseArtistTitleFromFilename('   ')).toEqual({ artist: '', title: '' });
  });
});
