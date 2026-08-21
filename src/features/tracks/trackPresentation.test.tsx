import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Track } from '../../types/domain';
import { TrackMetadataLine, TrackPrimaryLine } from './components/TrackPresentation';
import {
  formatTrackTagLabel,
  getTrackMetadataLineParts,
  getTrackMetadataText,
  getTrackPrimaryLabel,
} from './trackPresentation';

function trackWithMetadata(genres?: string[], tags?: string[], artist?: string): Track {
  return {
    schemaVersion: 1,
    trackId: 'track-1',
    ownerAddress: 'Q-owner',
    title: 'Time',
    artist,
    audio: { service: 'AUDIO', name: 'Owner', identifier: 'audio-1' },
    durationMs: 1000,
    genres,
    tags,
    source: 'station-upload',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('track primary label', () => {
  it('renders Artist — Title when an artist exists', () => {
    expect(getTrackPrimaryLabel(trackWithMetadata([], [], 'Pink Floyd'))).toBe('Pink Floyd — Time');
    expect(
      renderToStaticMarkup(<TrackPrimaryLine track={trackWithMetadata([], [], 'Pink Floyd')} />),
    ).toContain('Pink Floyd — Time');
  });

  it('renders only the title when the artist is missing or empty', () => {
    expect(getTrackPrimaryLabel(trackWithMetadata([], []))).toBe('Time');
    expect(
      renderToStaticMarkup(<TrackPrimaryLine track={trackWithMetadata([], [], '  ')} />),
    ).toContain('Time');
  });
});

describe('track metadata parts', () => {
  it('normalizes canonical taxonomy values and prefixes tags with #', () => {
    const parts = getTrackMetadataLineParts(
      trackWithMetadata(['Rock', ' ROCK '], ['classic', '70s']),
    );
    expect(parts.genres).toEqual(['Rock']);
    expect(parts.tags).toEqual(['#classic', '#70s']);
    expect(formatTrackTagLabel('#classic')).toBe('#classic');
    expect(formatTrackTagLabel('# classic')).toBe('#classic');
    expect(formatTrackTagLabel(' classic ')).toBe('#classic');
  });

  it('builds metadata text without empty separators', () => {
    expect(getTrackMetadataText({ genres: ['Progressive Rock'], tags: ['#classic', '#70s'] })).toBe(
      'Progressive Rock  #classic #70s',
    );
    expect(getTrackMetadataText({ genres: ['Rock'], tags: [] })).toBe('Rock');
    expect(getTrackMetadataText({ genres: [], tags: ['#chill'] })).toBe('#chill');
    expect(getTrackMetadataText({ genres: [], tags: [] })).toBe('');
  });
});

describe('TrackMetadataLine rendering', () => {
  it('renders genre only without a blank tag separator', () => {
    const html = renderToStaticMarkup(
      <TrackMetadataLine track={trackWithMetadata(['Rock'], [])} />,
    );
    expect(html).toContain('track-metadata-line__genres');
    expect(html).toContain('Rock');
    expect(html).not.toContain('track-metadata-line__tags');
  });

  it('renders tags only', () => {
    const html = renderToStaticMarkup(
      <TrackMetadataLine track={trackWithMetadata([], ['classic', '70s'])} />,
    );
    expect(html).toContain('track-metadata-line__tags');
    expect(html).toContain('#classic #70s');
    expect(html).not.toContain('track-metadata-line__genres');
  });

  it('renders both genre and tags when both are present', () => {
    const html = renderToStaticMarkup(
      <TrackMetadataLine track={trackWithMetadata(['Progressive Rock'], ['classic', '70s'])} />,
    );
    expect(html).toContain('Progressive Rock');
    expect(html).toContain('#classic #70s');
    expect(html).toContain('track-metadata-line__genres');
    expect(html).toContain('track-metadata-line__tags');
  });

  it('renders nothing for tracks with neither genre nor tags', () => {
    expect(renderToStaticMarkup(<TrackMetadataLine track={trackWithMetadata([], [])} />)).toBe('');
  });
});
