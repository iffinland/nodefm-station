/* ============================================================
 * NodeFM Station — App Router
 *
 * Route definitions for public and admin areas.
 * Admin routes are lazy-loaded and owner-gated.
 * Uses Qortium-compatible BrowserRouter with _qdnBase.
 * ============================================================ */

import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { getRouterBasename } from '../qortium/bridge';
import { useAuth } from './providers/authContext';
import { useStation } from '../features/station';
import { Layout } from './Layout';
import { AdminLayout } from './AdminLayout';
import { LoadingState } from '../components/LoadingState';

// ── Public Pages ──────────────────────────────────────────────────

const RadioPage = lazy(() => import('../pages/RadioPage'));
const PlaylistsPage = lazy(() => import('../pages/PlaylistsPage'));
const PlaylistDetailPage = lazy(() => import('../pages/PlaylistDetailPage'));
const AboutPage = lazy(() => import('../pages/AboutPage'));

// ── Admin Pages ───────────────────────────────────────────────────

const AdminDashboard = lazy(() => import('../pages/admin/AdminDashboard'));
const LibraryPage = lazy(() => import('../pages/admin/LibraryPage'));
const PlaylistsAdminPage = lazy(() => import('../pages/admin/PlaylistsAdminPage'));
const PlaylistEditorPage = lazy(() => import('../pages/admin/PlaylistEditorPage'));
const SchedulePage = lazy(() => import('../pages/admin/SchedulePage'));
const MessagesPage = lazy(() => import('../pages/admin/MessagesPage'));
const StationSettingsPage = lazy(() => import('../pages/admin/StationSettingsPage'));

// ── Page Loader ───────────────────────────────────────────────────

function PageLoader() {
  return <LoadingState message="Loading page…" />;
}

// ── Admin Guard ───────────────────────────────────────────────────

function AdminGuard({ children }: { children: React.ReactNode }) {
  const { auth } = useAuth();
  const { isOwner } = useStation();

  if (auth.status === 'loading') {
    return <LoadingState message="Checking authorization…" />;
  }

  if (!isOwner) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

// ── Router ────────────────────────────────────────────────────────

export function AppRouter() {
  const basename = getRouterBasename();

  return (
    <BrowserRouter basename={basename}>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          {/* ── Public Routes ── */}
          <Route element={<Layout />}>
            <Route index element={<RadioPage />} />
            <Route path="playlists" element={<PlaylistsPage />} />
            <Route path="playlists/:playlistId" element={<PlaylistDetailPage />} />
            <Route path="about" element={<AboutPage />} />
          </Route>

          {/* ── Admin Routes (owner only) ── */}
          <Route
            path="admin"
            element={
              <AdminGuard>
                <AdminLayout />
              </AdminGuard>
            }
          >
            <Route index element={<AdminDashboard />} />
            <Route path="library" element={<LibraryPage />} />
            <Route path="playlists" element={<PlaylistsAdminPage />} />
            <Route path="playlists/:playlistId" element={<PlaylistEditorPage />} />
            <Route path="schedule" element={<SchedulePage />} />
            <Route path="messages" element={<MessagesPage />} />
            <Route path="station" element={<StationSettingsPage />} />
          </Route>

          {/* ── Catch-all → Home ── */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
