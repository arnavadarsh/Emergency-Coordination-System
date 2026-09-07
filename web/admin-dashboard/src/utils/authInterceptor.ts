import axios from 'axios';
import TokenStorage from './tokenStorage';
import { UNIFIED_LOGIN_URL } from '../config/api';

/**
 * Sends the user back to sign in when the API says they are not authenticated.
 *
 * The dashboards poll every 30 seconds, so an unauthenticated page does not
 * fail once — it fails forever, on a timer. Two ways to get there, and both
 * have to recover:
 *
 *   - the stored token is no longer accepted (expired, account deactivated or
 *     deleted, backend repointed at another database);
 *   - there is no token at all, but a page is still polling. This origin hosts
 *     both the patient dashboard and the shared sign-in, so signing in as a
 *     driver, hospital or admin replaces the session here and hands it to that
 *     role's own app — any patient tab left open then polls with no token.
 *
 * An earlier version only acted when a token was still stored, which meant the
 * second case was ignored entirely: the tab sat there reporting "Unauthorized"
 * every 30 seconds with no way out.
 *
 * A 403 is different and is deliberately untouched: the account is valid but
 * may not perform that one action, which is no reason to end a session.
 */

/** The sign-in request answers 401 for a wrong password. That is not a dead
 *  session, and redirecting on it would trap the user on the sign-in page. */
const isAuthEndpoint = (url?: string): boolean => !!url && /\/auth\/(login|register)/.test(url);

/** Collapses a burst of failing polls into a single redirect. */
let lastRedirectAt = 0;
const REDIRECT_DEBOUNCE_MS = 3000;

export function installAuthInterceptor(): void {
  axios.interceptors.response.use(
    response => response,
    error => {
      const status = error?.response?.status;
      const url = error?.response?.config?.url ?? error?.config?.url;

      if (status === 401 && !isAuthEndpoint(url)) {
        TokenStorage.removeToken();

        const now = Date.now();
        if (now - lastRedirectAt > REDIRECT_DEBOUNCE_MS) {
          lastRedirectAt = now;
          window.location.href = `${UNIFIED_LOGIN_URL}/?signedOut=1`;
        }
      }
      return Promise.reject(error);
    },
  );
}
