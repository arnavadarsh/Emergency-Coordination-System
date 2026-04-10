import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import Dashboard from './pages/Dashboard';
import TokenStorage from './utils/tokenStorage';

const UNIFIED_LOGIN_URL = 'http://localhost:3004';

/**
 * Synchronously extract token from URL hash (#token=...) at module load time.
 * This runs before React renders, preventing a flash-redirect to login.
 */
(function extractTokenFromHash() {
  const hash = window.location.hash;
  if (hash.startsWith('#token=')) {
    const token = decodeURIComponent(hash.slice(7));
    TokenStorage.setToken(token);
    // Clean the hash from the URL without reloading
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
})();

/**
 * Protected Route Component
 */
const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const isAuthenticated = TokenStorage.hasToken();
  if (!isAuthenticated) {
    window.location.href = UNIFIED_LOGIN_URL;
    return null;
  }
  return <>{children}</>;
};

/**
 * Main App Component
 */
const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Toaster position="top-right" toastOptions={{ duration: 4000 }} />
      <Routes>
        <Route
          path="/"
          element={
            TokenStorage.hasToken()
              ? <Navigate to="/dashboard" />
              : (() => { window.location.href = UNIFIED_LOGIN_URL; return null; })()
          }
        />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
