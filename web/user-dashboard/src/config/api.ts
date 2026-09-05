/**
 * API Configuration
 *
 * Every address the app talks to is resolved here, from build-time environment
 * variables, so the same source builds for localhost and for a deployed server.
 * Vite inlines `import.meta.env.VITE_*` at build time — these must therefore be
 * set when the bundle is built, not when the container starts.
 *
 *   VITE_API_URL     Backend API base, including /api
 *   VITE_SOCKET_URL  WebSocket origin (defaults to VITE_API_URL without /api)
 *   VITE_LOGIN_URL   The unified sign-in app, for the "back to login" redirect
 */

const env = (import.meta as any).env ?? {};

const stripTrailingSlash = (value: string) => value.replace(/\/+$/, '');

/** Backend API base, e.g. https://api.example.com/api */
export const API_BASE_URL = stripTrailingSlash(env.VITE_API_URL || 'http://localhost:3000/api');

/**
 * Socket.IO origin. The gateway is mounted on the API server's root rather than
 * under /api, so the default drops that suffix.
 */
export const SOCKET_URL = stripTrailingSlash(env.VITE_SOCKET_URL || API_BASE_URL.replace(/\/api$/, ''));

/** Where sign-in lives — the user dashboard hosts the shared login screen. */
export const UNIFIED_LOGIN_URL = stripTrailingSlash(env.VITE_LOGIN_URL || 'http://localhost:3001');

/**
 * Where each role lands after signing in here.
 *
 * This app hosts the shared sign-in screen, so it hands a hospital, driver or
 * admin straight on to their own dashboard. The defaults are the dev servers;
 * a deployment sets these to the real hosts (or path prefixes on one host).
 */
export const ROLE_APP_URLS: Record<string, string> = {
  USER: '/dashboard',
  HOSPITAL: `${stripTrailingSlash(env.VITE_HOSPITAL_APP_URL || 'http://localhost:3004')}/dashboard`,
  DRIVER: `${stripTrailingSlash(env.VITE_DRIVER_APP_URL || 'http://localhost:3003')}/dashboard`,
  ADMIN: `${stripTrailingSlash(env.VITE_ADMIN_APP_URL || 'http://localhost:3002')}/dashboard`,
};

export const API_CONFIG = {
  BASE_URL: API_BASE_URL,
  
  // Auth endpoints
  LOGIN: '/auth/login',
  
  // User endpoints
  USER_PROFILE: '/user/profile',
  USER_BOOKINGS: '/user/bookings',
  CREATE_BOOKING: '/user/bookings',
  HOSPITALS: '/hospitals',
};
