import axios from 'axios';
import TokenStorage from './tokenStorage';
import { UNIFIED_LOGIN_URL } from '../config/api';

/**
 * Sends the user back to sign in when the server rejects their session.
 *
 * The dashboards call the API with the global axios instance, which had no
 * error handling of its own — so a token the server no longer accepts produced
 * an endless "Unauthorized" banner with no way out. A stored token can stop
 * being valid for ordinary reasons: it was issued by a backend pointed at a
 * different database, the account was deactivated, or it simply expired. In
 * every case the answer is the same, and it is not to sit there.
 *
 * Only 401 (this session is not valid) clears anything. A 403 means the account
 * is fine but may not perform that particular action, and must not destroy a
 * working session — during an emergency least of all.
 */
export function installAuthInterceptor(): void {
  axios.interceptors.response.use(
    response => response,
    error => {
      if (error?.response?.status === 401 && TokenStorage.hasToken()) {
        TokenStorage.removeToken();
        // Guard against a redirect loop if the sign-in page itself 401s.
        if (!sessionStorage.getItem('ecs:auth-redirect')) {
          sessionStorage.setItem('ecs:auth-redirect', '1');
          window.location.href = UNIFIED_LOGIN_URL;
        }
      }
      return Promise.reject(error);
    },
  );

  // A successful load means the session works; allow a future redirect again.
  window.addEventListener('load', () => sessionStorage.removeItem('ecs:auth-redirect'));
}
