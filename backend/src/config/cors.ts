/**
 * Origins allowed to reach the API and the realtime socket.
 *
 * `CORS_ORIGINS` is a comma-separated list of the dashboard origins, e.g.
 * "https://ecs.example.com,https://admin.ecs.example.com". HTTP and WebSocket
 * read the same list, so a site that cannot call the API cannot open a socket
 * either.
 */
export function configuredOrigins(): string[] {
  return (process.env.CORS_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

const isProduction = (): boolean => (process.env.NODE_ENV || 'development') === 'production';

/**
 * Whether a request carrying this Origin header may proceed.
 *
 * No Origin means a same-origin or server-to-server request (curl, a health
 * probe, a native client) — those are let through, and still need a valid token
 * for anything that matters. With no list configured, development allows every
 * origin; production refuses to start in that state (see startup-checks.ts).
 */
export function isOriginAllowed(origin: string | undefined | null): boolean {
  if (!origin) return true;

  const configured = configuredOrigins();
  if (configured.length === 0) return !isProduction();

  const normalized = origin.replace(/\/+$/, '');
  return configured.includes(normalized) || configured.includes('*');
}

/** The `origin` option for Express's and Socket.IO's CORS handling. */
export function corsOriginOption(): (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => void {
  return (origin, callback) => callback(null, isOriginAllowed(origin));
}
