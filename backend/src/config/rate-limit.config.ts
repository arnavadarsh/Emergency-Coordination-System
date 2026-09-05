import { registerAs } from '@nestjs/config';

export default registerAs('rateLimit', () => ({
  /**
   * Whether to believe X-Forwarded-For when identifying a caller.
   *
   * Only turn this on when a proxy you control sets that header. Reachable
   * directly, it lets anyone forge a fresh identity per request and walk
   * straight through every per-caller limit.
   */
  trustProxy: process.env.RATE_LIMIT_TRUST_PROXY === 'true',
}));
