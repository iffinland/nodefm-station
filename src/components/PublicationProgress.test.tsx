// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PublicationProgress, type PublicationProgressState } from './PublicationProgress';

function successState(): PublicationProgressState {
  return {
    phase: 'success',
    rows: [
      { id: 'audio', label: 'Audio file', status: 'succeeded' },
      { id: 'cover', label: 'Cover image', status: 'succeeded' },
      { id: 'track', label: 'Track metadata', status: 'succeeded' },
    ],
  };
}

function runningState(): PublicationProgressState {
  return {
    phase: 'publishing',
    rows: [
      { id: 'audio', label: 'Audio file', status: 'active' },
      { id: 'track', label: 'Track metadata', status: 'waiting' },
    ],
  };
}

describe('PublicationProgress', () => {
  afterEach(() => cleanup());

  it('renders the canonical success state with Close and no Retry', () => {
    const onClose = vi.fn();
    const onSuccess = vi.fn();

    render(
      <PublicationProgress
        title="Track Published"
        state={successState()}
        successMessage="Track published successfully."
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Track Published' })).toBeTruthy();
    expect(screen.getByText('Track published successfully.')).toBeTruthy();
    expect(screen.getAllByText('✓')).toHaveLength(3);

    const close = screen.getByText('Close');
    expect(close).toBeTruthy();
    expect(screen.queryByText('Retry')).toBeNull();

    fireEvent.click(close);
    expect(onSuccess).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('renders the active spinner and pending marker while running without Close', () => {
    render(
      <PublicationProgress title="Publishing Track" state={runningState()} onClose={vi.fn()} />,
    );

    expect(screen.getByRole('heading', { name: 'Publishing Track' })).toBeTruthy();
    expect(document.querySelector('.upload-publication__spinner')).toBeTruthy();
    expect(screen.getByText('•')).toBeTruthy();
    expect(screen.queryByText('Close')).toBeNull();
    expect(screen.queryByText('Retry')).toBeNull();
  });

  it('renders failure markers and Close with no Retry', () => {
    const onClose = vi.fn();

    render(
      <PublicationProgress
        title="Publishing Track"
        state={{
          phase: 'failed',
          rows: [
            { id: 'audio', label: 'Audio file', status: 'succeeded' },
            { id: 'track', label: 'Track metadata', status: 'failed', error: 'Failed.' },
          ],
          error: 'Failed.',
        }}
        onClose={onClose}
      />,
    );

    expect(document.querySelectorAll('.upload-publication__row--failed')).toHaveLength(1);
    expect(screen.getAllByText('Failed.').length).toBeGreaterThan(0);
    expect(screen.queryByText('Retry')).toBeNull();

    fireEvent.click(screen.getByText('Close'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
