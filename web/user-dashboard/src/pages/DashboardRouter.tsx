import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import TokenStorage from '../utils/tokenStorage';
import { ROLE_APP_URLS } from '../config/api';
import UserDashboard from './Dashboard';

/**
 * Decides what a signed-in account sees at /dashboard.
 *
 * This app is the patient dashboard, and it also hosts the shared sign-in
 * screen — so a driver, hospital or admin can end up here holding a valid
 * session. They are handed on to their own application rather than shown
 * anything locally.
 *
 * It used to render this app's own copies of the admin, hospital and driver
 * dashboards. Those copies had drifted well behind the real applications, so
 * anyone whose stored role was not USER — which is every non-patient who had
 * ever signed in through this app — was quietly shown an out-of-date portal
 * instead of the real one. The copies are gone; there is one implementation of
 * each dashboard, in its own app.
 */
const DashboardRouter: React.FC = () => {
  const navigate = useNavigate();
  const role = TokenStorage.getUserRole();

  useEffect(() => {
    if (!role) {
      // A session with no role is unusable; start again from sign-in.
      TokenStorage.clearToken();
      navigate('/');
      return;
    }

    if (role === 'USER') return;

    const target = ROLE_APP_URLS[role];
    if (!target) {
      TokenStorage.clearToken();
      navigate('/');
      return;
    }

    // The token travels in the URL fragment, the same handoff sign-in uses.
    // This app's own copy is cleared: it holds a patient session or none.
    const token = TokenStorage.getToken() ?? '';
    TokenStorage.clearToken();
    window.location.href = `${target}#token=${encodeURIComponent(token)}`;
  }, [role, navigate]);

  if (role !== 'USER') {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontSize: '18px', color: '#6b778c' }}>
        Taking you to your dashboard&hellip;
      </div>
    );
  }

  return <UserDashboard />;
};

export default DashboardRouter;
