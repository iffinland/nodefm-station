// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import { PageErrorBoundary } from '../components/PageErrorBoundary';

function ThrowingPage(): ReactElement {
  throw new Error('listener editor exploded');
}

function Harness({ pageKey }: { pageKey: string }) {
  return (
    <MemoryRouter>
      <header>Station shell</header>
      <PageErrorBoundary key={pageKey}>
        {pageKey === 'broken' ? <ThrowingPage /> : <div>Healthy page</div>}
      </PageErrorBoundary>
    </MemoryRouter>
  );
}

describe('PageErrorBoundary', () => {
  afterEach(() => {
    cleanup();
  });

  it('keeps the station shell visible and shows a page-level error', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<Harness pageKey="broken" />);

    expect(screen.getByText('Station shell')).toBeTruthy();
    expect(screen.getByText('This page could not be rendered.')).toBeTruthy();
    expect(screen.getByText('listener editor exploded')).toBeTruthy();

    consoleError.mockRestore();
  });

  it('clears a caught page error when the route key changes', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const view = render(<Harness pageKey="broken" />);

    expect(screen.getByText('This page could not be rendered.')).toBeTruthy();

    view.rerender(<Harness pageKey="healthy" />);

    expect(screen.queryByText('This page could not be rendered.')).toBeNull();
    expect(screen.getByText('Healthy page')).toBeTruthy();
    expect(screen.getByText('Station shell')).toBeTruthy();

    consoleError.mockRestore();
  });
});
