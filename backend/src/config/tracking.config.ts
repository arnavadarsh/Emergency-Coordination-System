import { registerAs } from '@nestjs/config';

/**
 * Shareable tracking-link settings.
 */
export default registerAs('tracking', () => ({
  /**
   * Where the public tracking page is served from. The case token is appended
   * to this, and the result is what family members receive by SMS — so it must
   * be an address reachable from a phone, not localhost, in any real deployment.
   */
  publicBaseUrl: (process.env.PUBLIC_TRACKING_BASE_URL || 'http://localhost:3001/track').replace(/\/+$/, ''),

  /**
   * Backstop lifetime. Links normally die when the case ends; this bounds a
   * case that is never closed out.
   */
  linkTtlHours: parseInt(process.env.TRACKING_LINK_TTL_HOURS || '24', 10),
}));
