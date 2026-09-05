import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { RateLimiterService } from './rate-limiter.service';
import { RATE_LIMIT_KEY, RateLimitOptions } from './rate-limit.decorator';

/**
 * RateLimitGuard
 *
 * Enforces the per-caller ceiling declared by `@RateLimit()` at the edge, before
 * a request can reach anything that costs money. Routes without the decorator
 * are untouched.
 *
 * Refused requests get a 429 with `Retry-After`, which is the honest answer to
 * a caller sending too much. The triage client treats any non-OK response as
 * "LLM unavailable" and continues with its offline rule-based engine, so a
 * throttled patient still gets triaged — they just get the deterministic path.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);
  private readonly trustProxy: boolean;

  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimiter: RateLimiterService,
    private readonly configService: ConfigService,
  ) {
    // Off by default: when the app is reachable directly, an attacker can set
    // X-Forwarded-For freely and mint a new identity per request. Turn this on
    // only when a trusted proxy in front of the app rewrites that header.
    this.trustProxy = configService.get<boolean>('rateLimit.trustProxy', false);
  }

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.getAllAndOverride<RateLimitOptions>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!options) return true;

    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const key = this.callerKey(request);

    const limit = options.limitPath
      ? this.configService.get<number>(options.limitPath, options.limit)
      : options.limit;

    const decision = this.rateLimiter.consume(options.bucket, key, {
      limit,
      windowMs: options.windowSeconds * 1000,
    });

    response?.setHeader?.('X-RateLimit-Limit', String(decision.limit));
    response?.setHeader?.('X-RateLimit-Remaining', String(Math.max(0, decision.remaining)));

    if (!decision.allowed) {
      response?.setHeader?.('Retry-After', String(decision.retryAfterSeconds));
      this.logger.warn(
        `[rate-limit] ${options.bucket}: refused ${key} — over ${limit}/${options.windowSeconds}s`,
      );
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'Too Many Requests',
          message: 'Too many requests. Please wait a moment and try again.',
          retryAfterSeconds: decision.retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  /**
   * Who is being limited: the signed-in user when known, so one person cannot
   * multiply their allowance by changing networks, and the client IP otherwise.
   */
  private callerKey(request: any): string {
    const userId = request?.user?.id;
    if (userId) return `user:${userId}`;

    if (this.trustProxy) {
      const forwarded = request?.headers?.['x-forwarded-for'];
      const first = Array.isArray(forwarded) ? forwarded[0] : String(forwarded ?? '').split(',')[0];
      if (first?.trim()) return `ip:${first.trim()}`;
    }

    return `ip:${request?.ip || request?.socket?.remoteAddress || 'unknown'}`;
  }
}
