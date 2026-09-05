import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

/**
 * How many requests are allowed in a rolling window.
 */
export interface RateLimitPolicy {
  /** Requests permitted per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Requests still available in the current window. */
  remaining: number;
  /** How long to wait before the next request would be allowed. 0 when allowed. */
  retryAfterSeconds: number;
  limit: number;
}

/**
 * RateLimiterService
 *
 * A rolling-window request counter, plus a slot-based concurrency limiter.
 *
 * The system calls paid third-party APIs (Gemini for triage conversation,
 * Google Distance Matrix for travel times) from endpoints that are reachable
 * without a login. Without a ceiling, one loop in a client — or one person
 * hammering the endpoint — turns directly into an unbounded bill. This puts
 * that ceiling in one place so every caller enforces it the same way.
 *
 * Rolling rather than fixed windows: a fixed window lets a caller spend the
 * whole of one window and the whole of the next back to back, which is exactly
 * the burst the limit exists to stop.
 *
 * State lives in this process. That is the right trade for a single-instance
 * deployment; running several instances behind a load balancer would need a
 * shared store (Redis), and each instance would otherwise enforce its own copy
 * of the limit.
 */
@Injectable()
export class RateLimiterService implements OnModuleDestroy {
  private readonly logger = new Logger(RateLimiterService.name);

  /** bucket → key → timestamps (ms) of the requests inside the window. */
  private readonly hits = new Map<string, Map<string, number[]>>();

  /** bucket → in-flight count, for the concurrency limiter. */
  private readonly inFlight = new Map<string, number>();

  /**
   * Guards against unbounded growth from a stream of distinct keys (many IPs).
   * When a bucket exceeds this, the coldest keys are dropped — they are by
   * definition the ones with no recent activity, so nothing is under-counted.
   */
  private static readonly MAX_KEYS_PER_BUCKET = 10_000;

  private readonly sweeper: NodeJS.Timeout;

  constructor() {
    // Windows expire on their own during reads, but a bucket nobody asks about
    // again would hold its timestamps forever. Sweep periodically.
    this.sweeper = setInterval(() => this.sweep(), 60_000);
    this.sweeper.unref?.();
  }

  onModuleDestroy(): void {
    clearInterval(this.sweeper);
  }

  /**
   * Record a request against `key` and say whether it is allowed.
   * A refused request is NOT recorded, so a caller being throttled cannot push
   * their own retry-after further out by continuing to hammer.
   */
  consume(bucket: string, key: string, policy: RateLimitPolicy): RateLimitDecision {
    const decision = this.peek(bucket, key, policy);
    if (decision.allowed) {
      this.bucketFor(bucket).get(key)!.push(Date.now());
    }
    return decision;
  }

  /** Same check as {@link consume}, without recording the request. */
  peek(bucket: string, key: string, policy: RateLimitPolicy): RateLimitDecision {
    if (policy.limit <= 0) {
      // A limit of zero disables the call path entirely.
      return { allowed: false, remaining: 0, retryAfterSeconds: policy.windowMs / 1000, limit: 0 };
    }

    const now = Date.now();
    const keys = this.bucketFor(bucket);
    const timestamps = this.prune(keys, key, now - policy.windowMs);

    if (timestamps.length < policy.limit) {
      return {
        allowed: true,
        remaining: policy.limit - timestamps.length - 1,
        retryAfterSeconds: 0,
        limit: policy.limit,
      };
    }

    // Full: the window frees up when its oldest entry falls out.
    const oldest = timestamps[0];
    const retryAfterMs = Math.max(0, oldest + policy.windowMs - now);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
      limit: policy.limit,
    };
  }

  /** Requests used in the current window — for usage reporting. */
  used(bucket: string, key: string, windowMs: number): number {
    return this.prune(this.bucketFor(bucket), key, Date.now() - windowMs).length;
  }

  /** Clears a key's history. Intended for tests and admin recovery. */
  reset(bucket: string, key?: string): void {
    if (key === undefined) {
      this.hits.delete(bucket);
      this.inFlight.delete(bucket);
    } else {
      this.hits.get(bucket)?.delete(key);
    }
  }

  // ── Concurrency ───────────────────────────────────────────────────────────

  /**
   * Take one of `max` slots, or return false if they are all busy.
   *
   * Rate limits alone do not stop a pile-up: a burst of slow upstream calls can
   * still leave dozens of requests in flight, each holding a socket and each
   * already billable. Every acquired slot must be released in a `finally`.
   */
  tryAcquireSlot(bucket: string, max: number): boolean {
    const current = this.inFlight.get(bucket) ?? 0;
    if (current >= max) return false;
    this.inFlight.set(bucket, current + 1);
    return true;
  }

  releaseSlot(bucket: string): void {
    const current = this.inFlight.get(bucket) ?? 0;
    this.inFlight.set(bucket, Math.max(0, current - 1));
  }

  activeSlots(bucket: string): number {
    return this.inFlight.get(bucket) ?? 0;
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private bucketFor(bucket: string): Map<string, number[]> {
    let keys = this.hits.get(bucket);
    if (!keys) {
      keys = new Map();
      this.hits.set(bucket, keys);
    }
    return keys;
  }

  /** Drops timestamps that have aged out, and returns what is left. */
  private prune(keys: Map<string, number[]>, key: string, cutoff: number): number[] {
    const existing = keys.get(key);
    if (!existing) {
      if (keys.size >= RateLimiterService.MAX_KEYS_PER_BUCKET) {
        this.evictColdest(keys);
      }
      const fresh: number[] = [];
      keys.set(key, fresh);
      return fresh;
    }

    let firstLive = 0;
    while (firstLive < existing.length && existing[firstLive] <= cutoff) firstLive++;
    if (firstLive > 0) existing.splice(0, firstLive);
    return existing;
  }

  /** Removes the tenth of keys whose most recent request is oldest. */
  private evictColdest(keys: Map<string, number[]>): void {
    const entries = [...keys.entries()]
      .map(([key, times]) => [key, times.length ? times[times.length - 1] : 0] as const)
      .sort((a, b) => a[1] - b[1]);

    const dropCount = Math.max(1, Math.floor(entries.length / 10));
    for (let i = 0; i < dropCount; i++) keys.delete(entries[i][0]);
    this.logger.warn(`[rate-limit] Evicted ${dropCount} cold keys to bound memory`);
  }

  /** Drops keys with no live timestamps at all. */
  private sweep(): void {
    const now = Date.now();
    // A day is the longest window any policy here uses; anything older than
    // that cannot affect a decision.
    const cutoff = now - 24 * 3600_000;
    for (const [bucket, keys] of this.hits) {
      for (const [key, times] of keys) {
        if (times.length === 0 || times[times.length - 1] <= cutoff) keys.delete(key);
      }
      if (keys.size === 0) this.hits.delete(bucket);
    }
  }
}
