import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import TokenStorage from './utils/tokenStorage';
import { PageLoading } from '@shared/components/ui/primitives';

// Each screen is its own download. A relative opening a tracking link from an
// SMS gets the tracking page, not the whole patient dashboard and triage
// engine; a patient signing in does not wait for the dashboard to load first.
const Landing = lazy(() => import('./pages/Landing'));
const DashboardRouter = lazy(() => import('./pages/DashboardRouter'));
const PublicTracking = lazy(() => import('./pages/PublicTracking'));

/**
 * Protected Route Component
 */
const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const isAuthenticated = TokenStorage.hasToken();
  return isAuthenticated ? <>{children}</> : <Navigate to="/" />;
};

/**
 * Main App Component
 */
/**
 * Vite's `base` only rewrites asset URLs — the router still sees the full path.
 * Deployed, the dashboards share one host and sit under sub-paths (/driver/,
 * /admin/, /hospital/), so without a basename the routes below never match and
 * the app renders nothing. BASE_URL is whatever the app was built with: "/"
 * locally, "/driver/" and so on deployed.
 */
const App: React.FC = () => {
  return (
    <BrowserRouter basename={(import.meta as any).env?.BASE_URL || '/'}>
      <Toaster position="top-right" toastOptions={{ duration: 4000, className: 'ui-toast' }} />
      <Suspense fallback={<PageLoading label="Loading…" />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        {/* Shared ambulance tracking. Deliberately outside ProtectedRoute:
            relatives open this from an SMS with no account and no app. */}
        <Route path="/track/:token" element={<PublicTracking />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <DashboardRouter />
            </ProtectedRoute>
          }
        />
      </Routes>
      </Suspense>
    </BrowserRouter>
  );
};

export default App;
