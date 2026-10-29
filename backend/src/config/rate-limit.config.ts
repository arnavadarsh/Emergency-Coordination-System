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

  /**
   * Password-guessing protection, per client IP. Generous enough for a ward of
   * staff behind one hospital NAT signing in at shift change, tight enough to
   * make guessing a password over the API impractical.
   */
  auth: {
    loginPerMinute: parseInt(process.env.AUTH_LOGIN_PER_MINUTE || '10', 10),
    registerPerHour: parseInt(process.env.AUTH_REGISTER_PER_HOUR || '10', 10),
  },
}));
