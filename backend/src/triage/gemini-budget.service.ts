import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RateLimiterService } from '../common/rate-limit/rate-limiter.service';

/** Why a call was not made. Surfaced in logs and the usage report. */
export type GeminiRefusal =
  | 'NOT_CONFIGURED'
  | 'GLOBAL_RATE'
  | 'DAILY_REQUESTS'
  | 'DAILY_TOKENS'
  | 'CONCURRENCY'
  | 'COOLDOWN';

export interface GeminiAdmission {
  allowed: boolean;
  refusal?: GeminiRefusal;
  /** When known, how long until this call would be admitted. */
  retryAfterSeconds?: number;
}

export interface GeminiUsageReport {
  configured: boolean;
  model: string;
  cooldownUntil: string | null;
  inFlight: number;
  limits: Record<string, number>;
  window: {
    lastMinuteRequests: number;
    last24hRequests: number;
    last24hTokens: number;
  };
  totals: {
    requests: number;
    served: number;
    refused: number;
    failed: number;
    promptTokens: number;
    outputTokens: number;
    /** null when no pricing is configured. */
    estimatedCostUsd: number | null;
  };
  refusalsByReason: Record<string, number>;
  lastError: { at: string; message: string } | null;
}

const BUCKET_REQUESTS = 'gemini:requests';
const BUCKET_TOKENS = 'gemini:tokens';
const BUCKET_CONCURRENCY = 'gemini';
const GLOBAL_KEY = 'all';
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 3600_000;

/**
 * GeminiBudgetService
 *
 * Decides whether the next Gemini call may happen, and keeps the record of what
 * has been spent. Separated from the triage logic on purpose: what a triage
 * conversation should say is a clinical question, and how much may be spent
 * saying it is an operational one, with completely different reasons to change.
 *
 * Four independent ceilings, because they fail differently:
 *   - requests per minute, globally — bounds the rate money can leave
 *   - requests per rolling day       — bounds a slow, all-day leak
 *   - tokens per rolling day         — the one that actually tracks the bill,
 *                                      since a long transcript costs far more
 *                                      than a short one at the same request rate
 *   - concurrent calls               — stops a burst piling up in flight
 *
 * Plus a cooldown: when Gemini itself says "too many requests", continuing to
 * send is how a quota problem turns into a billing problem.
 */
@Injectable()
export class GeminiBudgetService {
  private readonly logger = new Logger(GeminiBudgetService.name);

  private cooldownUntil = 0;

  private readonly totals = {
    requests: 0,
    served: 0,
    refused: 0,
    failed: 0,
    promptTokens: 0,
    outputTokens: 0,
  };
  private readonly refusalsByReason: Record<string, number> = {};
  private lastError: { at: string; message: string } | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  private limit(name: string): number {
    return this.configService.get<number>(`gemini.limits.${name}`, 0);
  }

  /**
   * Ask permission for one call. On success the caller holds a concurrency slot
   * and MUST call {@link release} in a finally block.
   */
  admit(): GeminiAdmission {
    this.totals.requests += 1;

    const now = Date.now();
    if (now < this.cooldownUntil) {
      return this.refuse('COOLDOWN', Math.ceil((this.cooldownUntil - now) / 1000));
    }

    // Cheapest checks first — peek, so a refusal further down does not consume
    // an allowance the call never actually used.
    const perDay = this.rateLimiter.peek(BUCKET_REQUESTS, GLOBAL_KEY, {
      limit: this.limit('dailyRequests'),
      windowMs: DAY_MS,
    });
    if (!perDay.allowed) return this.refuse('DAILY_REQUESTS', perDay.retryAfterSeconds);

    const perMinute = this.rateLimiter.peek(BUCKET_REQUESTS + ':minute', GLOBAL_KEY, {
      limit: this.limit('globalPerMinute'),
      windowMs: MINUTE_MS,
    });
    if (!perMinute.allowed) return this.refuse('GLOBAL_RATE', perMinute.retryAfterSeconds);

    const dailyTokens = this.limit('dailyTokens');
    if (dailyTokens > 0 && this.tokensUsedToday() >= dailyTokens) {
      return this.refuse('DAILY_TOKENS', 3600);
    }

    if (!this.rateLimiter.tryAcquireSlot(BUCKET_CONCURRENCY, this.limit('maxConcurrent'))) {
      return this.refuse('CONCURRENCY', 1);
    }

    // Committed: record the request against both windows.
    this.rateLimiter.consume(BUCKET_REQUESTS, GLOBAL_KEY, { limit: this.limit('dailyRequests'), windowMs: DAY_MS });
    this.rateLimiter.consume(BUCKET_REQUESTS + ':minute', GLOBAL_KEY, {
      limit: this.limit('globalPerMinute'),
      windowMs: MINUTE_MS,
    });

    return { allowed: true };
  }

  /** Releases the concurrency slot taken by {@link admit}. */
  release(): void {
    this.rateLimiter.releaseSlot(BUCKET_CONCURRENCY);
  }

  /** Records a completed call and what it cost in tokens. */
  recordSuccess(promptTokens: number, outputTokens: number): void {
    this.totals.served += 1;
    this.totals.promptTokens += promptTokens;
    this.totals.outputTokens += outputTokens;

    const total = promptTokens + outputTokens;
    if (total > 0) {
      // One rolling-window entry per 1k tokens keeps the day's token spend on
      // the same clock as everything else without storing a timestamp per token.
      const units = Math.max(1, Math.round(total / 1000));
      for (let i = 0; i < units; i++) {
        this.rateLimiter.consume(BUCKET_TOKENS, GLOBAL_KEY, { limit: Number.MAX_SAFE_INTEGER, windowMs: DAY_MS });
      }
    }
  }

  /**
   * Records a failed call. An upstream quota rejection starts a cooldown, since
   * the provider has explicitly asked us to stop.
   */
  recordFailure(error: unknown): void {
    this.totals.failed += 1;
    const message = String((error as any)?.message ?? error).slice(0, 300);
    this.lastError = { at: new Date().toISOString(), message };

    const throttled = /429|RESOURCE_EXHAUSTED|quota|rate limit/i.test(message);
    const seconds = throttled
      ? this.configService.get<number>('gemini.limits.throttleCooldownSeconds', 60)
      : this.configService.get<number>('gemini.limits.errorCooldownSeconds', 15);

    this.cooldownUntil = Date.now() + seconds * 1000;
    this.logger.warn(
      `[gemini] ${throttled ? 'Upstream quota rejection' : 'Upstream failure'} — pausing calls for ${seconds}s: ${message}`,
    );
  }

  /** Tokens consumed in the last 24 hours, from the rolling window. */
  tokensUsedToday(): number {
    return this.rateLimiter.used(BUCKET_TOKENS, GLOBAL_KEY, DAY_MS) * 1000;
  }

  report(): GeminiUsageReport {
    const cost = this.configService.get<{ inputPerMillionTokens: number; outputPerMillionTokens: number }>('gemini.cost');
    const priced = (cost?.inputPerMillionTokens ?? 0) > 0 || (cost?.outputPerMillionTokens ?? 0) > 0;

    return {
      configured: Boolean(this.configService.get<string>('gemini.apiKey')),
      model: this.configService.get<string>('gemini.model', ''),
      cooldownUntil: this.cooldownUntil > Date.now() ? new Date(this.cooldownUntil).toISOString() : null,
      inFlight: this.rateLimiter.activeSlots(BUCKET_CONCURRENCY),
      limits: {
        perCallerPerMinute: this.limit('perCallerPerMinute'),
        globalPerMinute: this.limit('globalPerMinute'),
        dailyRequests: this.limit('dailyRequests'),
        dailyTokens: this.limit('dailyTokens'),
        maxConcurrent: this.limit('maxConcurrent'),
        timeoutMs: this.limit('timeoutMs'),
      },
      window: {
        lastMinuteRequests: this.rateLimiter.used(BUCKET_REQUESTS + ':minute', GLOBAL_KEY, MINUTE_MS),
        last24hRequests: this.rateLimiter.used(BUCKET_REQUESTS, GLOBAL_KEY, DAY_MS),
        last24hTokens: this.tokensUsedToday(),
      },
      totals: {
        ...this.totals,
        estimatedCostUsd: priced
          ? Number(
              (
                (this.totals.promptTokens / 1_000_000) * (cost?.inputPerMillionTokens ?? 0) +
                (this.totals.outputTokens / 1_000_000) * (cost?.outputPerMillionTokens ?? 0)
              ).toFixed(6),
            )
          : null,
      },
      refusalsByReason: { ...this.refusalsByReason },
      lastError: this.lastError,
    };
  }

  private refuse(refusal: GeminiRefusal, retryAfterSeconds?: number): GeminiAdmission {
    this.totals.refused += 1;
    this.refusalsByReason[refusal] = (this.refusalsByReason[refusal] ?? 0) + 1;
    this.logger.warn(`[gemini] Call refused (${refusal}) — falling back to the offline triage engine`);
    return { allowed: false, refusal, retryAfterSeconds };
  }
}
