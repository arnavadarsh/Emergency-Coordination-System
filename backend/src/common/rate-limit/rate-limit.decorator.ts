import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'rate_limit_options';

export interface RateLimitOptions {
  /** Namespace for the counter, e.g. 'triage-converse'. */
  bucket: string;
  /** Requests permitted per window, per caller. Used when `limitPath` is unset
   *  or names nothing, so a route always has a working ceiling. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
  /**
   * Config key holding the limit, e.g. 'gemini.limits.perCallerPerMinute'.
   *
   * Decorators are evaluated once, at class definition, so the value cannot be
   * read from configuration here. Naming the key instead lets the guard resolve
   * it per request, which keeps the ceiling tunable by environment.
   */
  limitPath?: string;
}

/**
 * Cap how often one caller may hit this route.
 *
 * Usage: `@RateLimit({ bucket: 'triage-converse', limit: 20, windowSeconds: 60 })`
 * The caller is the authenticated user when there is one, otherwise the client
 * IP — see RateLimitGuard.
 */
export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, options);
