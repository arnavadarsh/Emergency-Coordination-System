import axios from 'axios';
import TokenStorage from './tokenStorage';
import { UNIFIED_LOGIN_URL } from '../config/api';

/**
 * Sends the user back to sign in when the server rejects their session.
 *
 * The dashboards poll the API every 30 seconds, so a session the server no
 * longer accepts does not fail once — it fails forever, every 30 seconds. A
 * stored token stops being valid for ordinary reasons: it expired, the account
 * was deactivated, the backend was repointed at a different database, or the
 * account was deleted outright. In every case the answer is to sign in again.
 *
 * Only 401 (this session is not valid) clears anything. A 403 means the account
 * is fine but may not perform that one action, and must never destroy a working
 * session — during an emergency least of all.
 */

/** Debounce, so a burst of failing polls redirects once rather than fighting. */
let lastRedirectAt = 0;
const REDIRECT_DEBOUNCE_MS = 3000;

export function installAuthInterceptor(): void {
  axios.interceptors.response.use(
    response => response,
    error => {
      // Only act on a rejected *session*. With no token stored there is nothing
      // to sign out of — which is also what keeps a failed login on the sign-in
      // page from bouncing in a loop.
      if (error?.response?.status === 401 && TokenStorage.hasToken()) {
        TokenStorage.removeToken();

        const now = Date.now();
        if (now - lastRedirectAt > REDIRECT_DEBOUNCE_MS) {
          lastRedirectAt = now;
          window.location.href = UNIFIED_LOGIN_URL;
        }
      }
      return Promise.reject(error);
    },
  );
}
