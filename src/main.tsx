/* ============================================================
 * NodeFM Station — Entry Point
 * ============================================================ */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { installWindowStartupDiagnostics } from './services/perf/startupDiagnostics';
import './index.css';

installWindowStartupDiagnostics();

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
