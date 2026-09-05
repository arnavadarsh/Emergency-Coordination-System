import { Global, Module } from '@nestjs/common';
import { RateLimiterService } from './rate-limiter.service';
import { RateLimitGuard } from './rate-limit.guard';

/**
 * Rate Limit Module
 *
 * Global: request ceilings are a cross-cutting concern, and the counters must
 * be shared — a limiter instantiated per feature module would let a caller
 * spend the same allowance several times over.
 */
@Global()
@Module({
  providers: [RateLimiterService, RateLimitGuard],
  exports: [RateLimiterService, RateLimitGuard],
})
export class RateLimitModule {}
