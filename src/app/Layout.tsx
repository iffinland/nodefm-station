/* ============================================================
 * NodeFM Station — Public Layout
 *
 * Public-facing layout with navigation header and player bar.
 * ============================================================ */

import { Link, Outlet, useLocation } from 'react-router-dom';

const PUBLIC_NAV = [
  { to: '/', label: 'Radio' },
  { to: '/playlists', label: 'Playlists' },
  { to: '/about', label: 'About' },
] as const;

export function Layout() {
  const location = useLocation();

  return (
    <div className="layout layout--public">
      <header className="layout__header">
        <div className="layout__brand">
          <Link to="/" className="layout__brand-link">
            NodeFM
          </Link>
        </div>
        <nav className="layout__nav" aria-label="Main navigation">
          {PUBLIC_NAV.map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              className={`layout__nav-link${location.pathname === to ? ' layout__nav-link--active' : ''}`}
            >
              {label}
            </Link>
          ))}
        </nav>
      </header>

      <main className="layout__main">
        <Outlet />
      </main>

      <footer className="layout__player-bar">
        <div className="player-bar__info">
          <span className="player-bar__status">LIVE</span>
          <span className="player-bar__track">—</span>
        </div>
        <div className="player-bar__controls">
          <button className="player-bar__btn" type="button" aria-label="Play / Pause" disabled>
            ▶
          </button>
        </div>
        <div className="player-bar__volume">{/* Volume control — placeholder for Phase 2+ */}</div>
      </footer>
    </div>
  );
}
