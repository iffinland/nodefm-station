// @vitest-environment jsdom

/* ============================================================
 * NodeFM Station — Submit Music Form auth-refresh integrity
 *
 * Home reports a wallet lock-state change through the same
 * `qortium:selected-account-changed` signal as a real account change, so the
 * auth provider briefly reports `loading` while the account is unchanged.
 *
 * Regression under test: that transient collapsed the form's identity key,
 * which reset the listener's submission draft and destroyed any in-flight
 * publication progress even though the account itself never changed.
 * ============================================================ */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SubmitMusicForm } from '../features/listener-submissions/components/SubmitMusicForm';
import type { AuthState } from '../qortium/auth';
import type { SubmissionPublishResult } from '../features/listener-submissions/services/submissionStore';

const harness = vi.hoisted(() => ({
  auth: { status: 'authenticated', address: 'Q-listener-a', name: 'listener-a' } as AuthState,
  publishCalls: 0,
  resolvePublish: null as null | ((result: SubmissionPublishResult) => void),
}));

vi.mock('../app/providers/authContext', () => ({
  useAuth: () => ({ auth: harness.auth }),
}));

vi.mock('../qortium/qdn', () => ({
  selectPublishSource: vi.fn(async () => ({
    canceled: false,
    fileName: 'demo-track.wav',
    kind: 'file',
    mimeType: 'audio/wav',
    size: 1024,
    sourceToken: 'source-token-1',
  })),
}));

vi.mock('../features/listener-submissions/services/submissionStore', () => ({
  publishListenerSubmission: () => {
    harness.publishCalls += 1;

    return new Promise<SubmissionPublishResult>((resolve) => {
      harness.resolvePublish = resolve;
    });
  },
}));

vi.mock('../features/taxonomy', async () => {
  const { createElement } = await import('react');

  return {
    TaxonomyInput: (props: {
      value: string;
      onChange: (value: string) => void;
      placeholder?: string;
    }) =>
      createElement('input', {
        value: props.value,
        placeholder: props.placeholder,
        onChange: (event: { target: { value: string } }) => props.onChange(event.target.value),
      }),
    useTaxonomy: () => ({ genres: [], tags: [], remember: () => {} }),
    getCanonicalTaxonomyValues: () => [],
  };
});

vi.mock('../features/metadata-intelligence', async () => {
  const { createElement } = await import('react');
  const TextInput = (props: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
  }) =>
    createElement('input', {
      value: props.value,
      placeholder: props.placeholder,
      onChange: (event: { target: { value: string } }) => props.onChange(event.target.value),
    });

  return {
    TitleInput: TextInput,
    ArtistInput: TextInput,
    AlbumInput: TextInput,
    ReleaseDateInput: TextInput,
    isValidReleaseDateValue: () => true,
  };
});

const lockRefresh: AuthState = { status: 'loading' };
const sameAccountUnlocked: AuthState = {
  status: 'authenticated',
  address: 'Q-listener-a',
  name: 'listener-a',
};
const otherAccount: AuthState = {
  status: 'authenticated',
  address: 'Q-listener-b',
  name: 'listener-b',
};
const unauthenticated: AuthState = { status: 'unauthenticated' };

const loadingMessage = /Checking Qortium identity/;

async function selectAudio() {
  await act(async () => {
    fireEvent.click(screen.getByText('Select Audio File'));
  });
}

function albumField() {
  return screen.getByPlaceholderText('Optional album name') as HTMLInputElement;
}

function titleField() {
  return screen.getByPlaceholderText('Track title') as HTMLInputElement;
}

describe('submit music form across auth refreshes', () => {
  beforeEach(() => {
    harness.auth = { status: 'authenticated', address: 'Q-listener-a', name: 'listener-a' };
    harness.publishCalls = 0;
    harness.resolvePublish = null;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('keeps the authored draft through a lock-state-only refresh', async () => {
    const view = render(<SubmitMusicForm />);

    await selectAudio();
    fireEvent.change(albumField(), { target: { value: 'Locked Album' } });
    expect(screen.getByText(/demo-track\.wav/)).toBeTruthy();
    expect(titleField().value).toBe('demo-track');

    harness.auth = lockRefresh;
    view.rerender(<SubmitMusicForm />);

    // The lock-state refresh is not an identity change: the draft survives.
    expect(screen.queryByText(loadingMessage)).toBeNull();
    expect(screen.getByText(/demo-track\.wav/)).toBeTruthy();
    expect(albumField().value).toBe('Locked Album');
    expect(titleField().value).toBe('demo-track');

    harness.auth = sameAccountUnlocked;
    view.rerender(<SubmitMusicForm />);

    expect(screen.getByText(/demo-track\.wav/)).toBeTruthy();
    expect(albumField().value).toBe('Locked Album');
  });

  it('does not destroy in-flight publication progress across a lock-state-only refresh', async () => {
    const view = render(<SubmitMusicForm />);

    await selectAudio();
    fireEvent.click(screen.getByText('Submit Music'));

    expect(await screen.findByText('Track metadata')).toBeTruthy();
    expect(harness.publishCalls).toBe(1);

    harness.auth = lockRefresh;
    view.rerender(<SubmitMusicForm />);

    // The resumed publication keeps owning the progress UI.
    expect(screen.queryByText(loadingMessage)).toBeNull();
    expect(screen.getByText('Track metadata')).toBeTruthy();
    expect(screen.getByText('Audio file')).toBeTruthy();
    expect(harness.publishCalls).toBe(1);

    harness.auth = sameAccountUnlocked;
    view.rerender(<SubmitMusicForm />);

    expect(screen.getByText('Track metadata')).toBeTruthy();
    expect(harness.publishCalls).toBe(1);

    await act(async () => {
      harness.resolvePublish?.({ status: 'failed', reason: 'Resumed publish failed.' });
    });

    expect(screen.getAllByText('Resumed publish failed.').length).toBeGreaterThan(0);
    expect(screen.getByText('Close')).toBeTruthy();
  });

  it('resets the draft and isolates an in-flight publication on a real account change', async () => {
    const view = render(<SubmitMusicForm />);

    await selectAudio();
    fireEvent.click(screen.getByText('Submit Music'));

    expect(await screen.findByText('Track metadata')).toBeTruthy();
    expect(harness.publishCalls).toBe(1);

    harness.auth = otherAccount;
    view.rerender(<SubmitMusicForm />);

    // A real identity change is still a reset: no inherited draft or progress.
    expect(screen.queryByText('Track metadata')).toBeNull();
    expect(screen.getByText('No audio selected.')).toBeTruthy();
    expect(titleField().value).toBe('');
    expect(albumField().value).toBe('');

    await act(async () => {
      harness.resolvePublish?.({ status: 'failed', reason: 'Stale run failure.' });
    });

    // The completed write of the previous account must not surface here.
    expect(screen.queryAllByText('Stale run failure.')).toHaveLength(0);
    expect(screen.queryByText('Track metadata')).toBeNull();
  });

  it('keeps the safe reset when the account becomes unauthenticated', async () => {
    const view = render(<SubmitMusicForm />);

    await selectAudio();
    expect(screen.getByText(/demo-track\.wav/)).toBeTruthy();

    harness.auth = unauthenticated;
    view.rerender(<SubmitMusicForm />);

    expect(screen.getByText('Sign in to submit music')).toBeTruthy();

    harness.auth = sameAccountUnlocked;
    view.rerender(<SubmitMusicForm />);

    expect(screen.getByText('No audio selected.')).toBeTruthy();
    expect(titleField().value).toBe('');
  });
});
