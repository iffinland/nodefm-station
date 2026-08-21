// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { BulkImportWorkspace } from './components/BulkImportWorkspace';
import { extractEmbeddedAudioMetadata } from './services/audioMetadata';
import { resolveLocalAudioDurationMs, shouldAttemptLocalAudioDecode } from './services/localAudio';
import { saveBulkImportBatch } from './services/bulkImportStorage';
import { createBulkImportBatch, createBulkImportRow } from './batchStore';
import { MetadataIntelligenceContext } from '../metadata-intelligence/metadataIntelligenceContext';
import type { MetadataIndex } from '../metadata-intelligence/metadataIntelligence';
import { TaxonomyContext } from '../taxonomy/taxonomyContext';
import type { EmbeddedAudioMetadata } from './types';

vi.mock('./services/audioMetadata', () => ({
  extractEmbeddedAudioMetadata: vi.fn(),
}));

vi.mock('./services/localAudio', () => ({
  resolveLocalAudioDurationMs: vi.fn(),
  shouldAttemptLocalAudioDecode: vi.fn(() => true),
  BULK_IMPORT_LOCAL_DECODE_MAX_BYTES: 50 * 1024 * 1024,
}));

const mockExtract = vi.mocked(extractEmbeddedAudioMetadata);
const mockResolveDuration = vi.mocked(resolveLocalAudioDurationMs);
const mockShouldDecode = vi.mocked(shouldAttemptLocalAudioDecode);

const createObjectUrlMock = vi.fn();
const revokeObjectUrlMock = vi.fn();
let urlCounter = 0;

function metadata(overrides: Partial<EmbeddedAudioMetadata> = {}): EmbeddedAudioMetadata {
  return {
    artist: 'Artist',
    title: 'Title',
    album: '',
    releaseDate: '',
    genres: [],
    durationMs: 120000,
    picture: null,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function makeAudioFile(name: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: 'audio/mpeg' });
}

function selectMainAudio(container: HTMLElement, file: File): void {
  const input = container.querySelector('input[type="file"][accept="audio/*"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

function selectRowAudio(container: HTMLElement, file: File): void {
  const input = container.querySelector(
    '.bulk-import-row input[type="file"][accept="audio/*"]',
  ) as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

const metadataIndex: MetadataIndex = {
  artists: [],
  titlesByArtist: new Map(),
  albumsByArtist: new Map(),
  albums: [],
};

function Providers({ children }: { children: ReactNode }) {
  return (
    <MetadataIntelligenceContext.Provider
      value={{
        index: metadataIndex,
        artists: [],
        getTitlesForArtist: () => [],
        getAlbumsForArtist: () => [],
      }}
    >
      <TaxonomyContext.Provider value={{ genres: [], tags: [], remember: vi.fn() }}>
        {children}
      </TaxonomyContext.Provider>
    </MetadataIntelligenceContext.Provider>
  );
}

function renderWorkspace(scope = 'scope-a', role: 'admin' | 'listener' = 'listener') {
  return render(
    <Providers>
      <BulkImportWorkspace role={role} scope={scope} />
    </Providers>,
  );
}

async function flush(): Promise<void> {
  await act(async () => {});
}

describe('BulkImportWorkspace lifecycle and isolation', () => {
  beforeEach(() => {
    cleanup();
    window.sessionStorage.clear();
    urlCounter = 0;
    mockExtract.mockReset();
    mockResolveDuration.mockReset();
    mockShouldDecode.mockReset();
    mockShouldDecode.mockReturnValue(true);
    mockResolveDuration.mockResolvedValue(null);

    createObjectUrlMock.mockReset();
    revokeObjectUrlMock.mockReset();
    createObjectUrlMock.mockImplementation(() => `blob:preview-${++urlCounter}`);
    Object.defineProperty(URL, 'createObjectURL', {
      value: createObjectUrlMock,
      configurable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: revokeObjectUrlMock,
      configurable: true,
    });
    window.confirm = vi.fn(() => true) as unknown as typeof window.confirm;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('does not let a delayed parse overwrite a later source replacement', async () => {
    const oldExtraction = deferred<EmbeddedAudioMetadata>();
    mockExtract.mockImplementation((file) => {
      if (file.name === 'Old Artist - Old Title.mp3') return oldExtraction.promise;
      return Promise.resolve(metadata({ artist: 'New Artist', title: 'New Title' }));
    });

    const { container } = renderWorkspace();
    selectMainAudio(container, makeAudioFile('Old Artist - Old Title.mp3'));
    await flush();

    expect(container.textContent).toContain('Old Artist - Old Title.mp3');

    selectRowAudio(container, makeAudioFile('New Artist - New Title.mp3'));
    await flush();

    expect(container.textContent).toContain('New Artist');
    expect(container.textContent).not.toContain('Old Artist');

    oldExtraction.resolve(metadata({ artist: 'Old Artist', title: 'Old Title' }));
    await flush();

    expect(container.textContent).toContain('New Artist');
    expect(container.textContent).not.toContain('Old Artist');
  });

  it('does not resurrect a row removed while its parse was in flight', async () => {
    const pending = deferred<EmbeddedAudioMetadata>();
    mockExtract.mockReturnValue(pending.promise);

    const { container } = renderWorkspace();
    selectMainAudio(container, makeAudioFile('A - B.mp3'));
    await flush();

    fireEvent.click(screen.getByRole('button', { name: /^Remove$/ }));
    await flush();
    expect(container.textContent).toContain('No staged tracks yet.');

    pending.resolve(metadata({ artist: 'Late', title: 'Result' }));
    await flush();

    expect(container.textContent).not.toContain('Late');
    expect(container.textContent).toContain('No staged tracks yet.');
  });

  it('does not commit a delayed parse after the batch is cleared', async () => {
    const pending = deferred<EmbeddedAudioMetadata>();
    mockExtract.mockReturnValue(pending.promise);

    const { container } = renderWorkspace();
    selectMainAudio(container, makeAudioFile('A - B.mp3'));
    await flush();

    fireEvent.click(screen.getByRole('button', { name: 'Clear Batch' }));
    await flush();
    expect(container.textContent).toContain('No staged tracks yet.');

    pending.resolve(metadata({ artist: 'Late', title: 'Result' }));
    await flush();

    expect(container.textContent).not.toContain('Late');
  });

  it('never creates or leaks a preview URL after unmount', async () => {
    const pending = deferred<EmbeddedAudioMetadata>();
    mockExtract.mockReturnValue(pending.promise);

    const { container, unmount } = renderWorkspace();
    selectMainAudio(container, makeAudioFile('A - B.mp3'));
    await flush();

    unmount();
    await flush();

    pending.resolve(
      metadata({
        picture: { data: new Uint8Array([1, 2, 3]), format: 'image/jpeg', fileName: 'c.jpg' },
      }),
    );
    await flush();

    expect(createObjectUrlMock).not.toHaveBeenCalled();
    expect(revokeObjectUrlMock).not.toHaveBeenCalled();
  });

  it('cancels old analysis on account scope change and never renders prior rows', async () => {
    const pending = deferred<EmbeddedAudioMetadata>();
    mockExtract.mockReturnValue(pending.promise);

    const { container, rerender } = renderWorkspace('listener-a');
    selectMainAudio(container, makeAudioFile('Listener A - Secret.mp3'));
    await flush();
    expect(container.textContent).toContain('Listener A - Secret.mp3');

    rerender(
      <Providers>
        <BulkImportWorkspace role="listener" scope="listener-b" />
      </Providers>,
    );
    await flush();

    expect(container.textContent).not.toContain('Listener A - Secret.mp3');

    pending.resolve(metadata({ artist: 'Late', title: 'Result' }));
    await flush();

    expect(container.textContent).not.toContain('Listener A - Secret.mp3');
    expect(container.textContent).not.toContain('Late');
  });

  it('renders the new account batch synchronously without the prior account batch', async () => {
    const priorBatch = createBulkImportBatch('listener', 'listener-a', { id: 'batch-a' });
    priorBatch.rows.push(
      createBulkImportRow({
        id: 'row-a',
        fileName: 'Secret - Track.mp3',
        mimeType: 'audio/mpeg',
        sizeBytes: 10,
      }),
    );
    saveBulkImportBatch(priorBatch);

    const { container, rerender } = renderWorkspace('listener-a');
    await flush();
    expect(container.textContent).toContain('Secret - Track.mp3');

    rerender(
      <Providers>
        <BulkImportWorkspace role="listener" scope="listener-b" />
      </Providers>,
    );
    await flush();

    expect(container.textContent).not.toContain('Secret - Track.mp3');
    expect(container.textContent).toContain('No staged tracks yet.');
  });

  it('revokes cover preview URLs when a cover is removed', async () => {
    mockExtract.mockResolvedValue(
      metadata({
        picture: { data: new Uint8Array([1, 2, 3]), format: 'image/jpeg', fileName: 'c.jpg' },
      }),
    );

    const { container } = renderWorkspace();
    selectMainAudio(container, makeAudioFile('A - B.mp3'));
    await flush();

    const previewUrl = createObjectUrlMock.mock.results[0]?.value as string;
    expect(previewUrl).toMatch(/^blob:preview-/);
    expect(container.querySelector('img')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Remove cover' }));
    await flush();

    expect(revokeObjectUrlMock).toHaveBeenCalledWith(previewUrl);
  });

  it('revokes an existing embedded cover URL when the audio source is replaced', async () => {
    mockExtract.mockImplementation((file) =>
      Promise.resolve(
        file.name === 'A - B.mp3'
          ? metadata({
              picture: { data: new Uint8Array([1, 2, 3]), format: 'image/jpeg', fileName: 'c.jpg' },
            })
          : metadata(),
      ),
    );

    const { container } = renderWorkspace();
    selectMainAudio(container, makeAudioFile('A - B.mp3'));
    await flush();

    const previewUrl = createObjectUrlMock.mock.results[0]?.value as string;
    expect(previewUrl).toMatch(/^blob:preview-/);
    expect(container.querySelector('img')).toBeTruthy();

    selectRowAudio(container, makeAudioFile('New Artist - New Title.mp3'));
    await flush();

    expect(revokeObjectUrlMock).toHaveBeenCalledWith(previewUrl);
    expect(container.querySelector('img')).toBeNull();
  });

  it('revokes an existing embedded cover URL when the row is removed', async () => {
    mockExtract.mockResolvedValue(
      metadata({
        picture: { data: new Uint8Array([1, 2, 3]), format: 'image/jpeg', fileName: 'c.jpg' },
      }),
    );

    const { container } = renderWorkspace();
    selectMainAudio(container, makeAudioFile('A - B.mp3'));
    await flush();

    const previewUrl = createObjectUrlMock.mock.results[0]?.value as string;
    fireEvent.click(screen.getByRole('button', { name: /^Remove$/ }));
    await flush();

    expect(revokeObjectUrlMock).toHaveBeenCalledWith(previewUrl);
    expect(container.textContent).toContain('No staged tracks yet.');
  });

  it('revokes an existing embedded cover URL when the batch is cleared', async () => {
    mockExtract.mockResolvedValue(
      metadata({
        picture: { data: new Uint8Array([1, 2, 3]), format: 'image/jpeg', fileName: 'c.jpg' },
      }),
    );

    const { container } = renderWorkspace();
    selectMainAudio(container, makeAudioFile('A - B.mp3'));
    await flush();

    const previewUrl = createObjectUrlMock.mock.results[0]?.value as string;
    fireEvent.click(screen.getByRole('button', { name: 'Clear Batch' }));
    await flush();

    expect(revokeObjectUrlMock).toHaveBeenCalledWith(previewUrl);
    expect(container.textContent).toContain('No staged tracks yet.');
  });

  it('revokes an existing embedded cover URL on unmount', async () => {
    mockExtract.mockResolvedValue(
      metadata({
        picture: { data: new Uint8Array([1, 2, 3]), format: 'image/jpeg', fileName: 'c.jpg' },
      }),
    );

    const { container, unmount } = renderWorkspace();
    selectMainAudio(container, makeAudioFile('A - B.mp3'));
    await flush();

    const previewUrl = createObjectUrlMock.mock.results[0]?.value as string;
    unmount();
    await flush();

    expect(revokeObjectUrlMock).toHaveBeenCalledWith(previewUrl);
  });
});
