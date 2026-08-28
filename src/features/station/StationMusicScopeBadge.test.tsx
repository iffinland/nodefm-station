// @vitest-environment jsdom

/* ============================================================
 * NodeFM Station — Station Music Scope Badge Tests
 * ============================================================ */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StationMusicScopeBadge } from './StationMusicScopeBadge';

describe('StationMusicScopeBadge', () => {
  it('renders International Music for INTERNATIONAL', () => {
    render(<StationMusicScopeBadge musicScope="INTERNATIONAL" />);
    expect(screen.getByText('International Music')).toBeTruthy();
  });

  it('renders Regional Music for REGIONAL', () => {
    render(<StationMusicScopeBadge musicScope="REGIONAL" />);
    expect(screen.getByText('Regional Music')).toBeTruthy();
  });

  it('renders Mixed Music for MIXED', () => {
    render(<StationMusicScopeBadge musicScope="MIXED" />);
    expect(screen.getByText('Mixed Music')).toBeTruthy();
  });

  it('renders nothing when the legacy field is absent', () => {
    const { container } = render(<StationMusicScopeBadge musicScope={undefined} />);
    expect(container.textContent).toBe('');
  });
});
