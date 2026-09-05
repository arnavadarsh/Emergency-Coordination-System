import { GeminiBudgetService } from './gemini-budget.service';
import { RateLimiterService } from '../common/rate-limit/rate-limiter.service';

/**
 * The ceilings around a paid model reached from an endpoint with no login.
 */
describe('GeminiBudgetService', () => {
  let budget: GeminiBudgetService;
  let limiter: RateLimiterService;
  let limits: Record<string, number>;

  const config = {
    get: (key: string, fallback?: any) => {
      if (key.startsWith('gemini.limits.')) return limits[key.replace('gemini.limits.', '')] ?? fallback;
      if (key === 'gemini.apiKey') return 'test-key';
      if (key === 'gemini.model') return 'gemini-2.5-flash';
      if (key === 'gemini.cost') return { inputPerMillionTokens: 0.3, outputPerMillionTokens: 2.5 };
      return fallback;
    },
  };

  beforeEach(() => {
    jest.useFakeTimers();
    limits = {
      perCallerPerMinute: 15,
      globalPerMinute: 3,
      dailyRequests: 5,
      dailyTokens: 10_000,
      maxConcurrent: 2,
      timeoutMs: 12_000,
      throttleCooldownSeconds: 60,
      errorCooldownSeconds: 15,
    };
    limiter = new RateLimiterService();
    budget = new GeminiBudgetService(config as any, limiter);
  });

  afterEach(() => {
    limiter.onModuleDestroy();
    jest.useRealTimers();
  });

  /** admit() takes a concurrency slot; a real caller always releases it. */
  const call = () => {
    const admission = budget.admit();
    if (admission.allowed) budget.release();
    return admission;
  };

  it('admits calls inside every ceiling', () => {
    expect(call().allowed).toBe(true);
  });

  it('stops the global per-minute rate', () => {
    for (let i = 0; i < 3; i++) expect(call().allowed).toBe(true);
    const refused = call();
    expect(refused.allowed).toBe(false);
    expect(refused.refusal).toBe('GLOBAL_RATE');
  });

  it('stops a slow all-day leak with the daily request budget', () => {
    for (let i = 0; i < 5; i++) {
      call();
      jest.advanceTimersByTime(60_000); // stay under the per-minute rate
    }
    expect(call().refusal).toBe('DAILY_REQUESTS');
  });

  it('stops on the token budget, which is what actually tracks the bill', () => {
    budget.admit();
    budget.release();
    budget.recordSuccess(9_000, 2_000); // 11k tokens, over the 10k ceiling

    expect(call().refusal).toBe('DAILY_TOKENS');
  });

  it('caps calls in flight', () => {
    expect(budget.admit().allowed).toBe(true);
    expect(budget.admit().allowed).toBe(true);
    const third = budget.admit();
    expect(third.allowed).toBe(false);
    expect(third.refusal).toBe('CONCURRENCY');

    budget.release();
    expect(budget.admit().allowed).toBe(true);
  });

  it('does not spend a rate allowance on a call refused for concurrency', () => {
    budget.admit();
    budget.admit();
    budget.admit(); // refused — concurrency
    budget.release();
    budget.release();

    // Two admitted so far, so one remains under the 3/minute ceiling.
    expect(call().allowed).toBe(true);
    expect(call().allowed).toBe(false);
  });

  it('pauses calling after the provider rejects us for quota', () => {
    budget.recordFailure(new Error('429 RESOURCE_EXHAUSTED: quota exceeded'));

    const refused = call();
    expect(refused.refusal).toBe('COOLDOWN');
    expect(refused.retryAfterSeconds).toBeGreaterThan(50);

    jest.advanceTimersByTime(61_000);
    expect(call().allowed).toBe(true);
  });

  it('pauses more briefly after an ordinary upstream failure', () => {
    budget.recordFailure(new Error('503 Service Unavailable'));
    expect(call().retryAfterSeconds).toBeLessThanOrEqual(15);

    jest.advanceTimersByTime(16_000);
    expect(call().allowed).toBe(true);
  });

  describe('usage report', () => {
    it('accounts for requests, tokens and an approximate spend', () => {
      budget.admit();
      budget.release();
      budget.recordSuccess(1_000, 500);

      const report = budget.report();
      expect(report.configured).toBe(true);
      expect(report.totals.served).toBe(1);
      expect(report.window.last24hRequests).toBe(1);
      expect(report.window.last24hTokens).toBeGreaterThan(0);
      // 1000 input @ $0.30/M + 500 output @ $2.50/M
      expect(report.totals.estimatedCostUsd).toBeCloseTo(0.0003 + 0.00125, 5);
    });

    it('records why calls were refused', () => {
      for (let i = 0; i < 4; i++) call();
      expect(budget.report().refusalsByReason.GLOBAL_RATE).toBe(1);
      expect(budget.report().totals.refused).toBe(1);
    });

    it('omits the cost estimate when no pricing is configured', () => {
      const unpriced = new GeminiBudgetService(
        { get: (k: string, f?: any) => (k === 'gemini.cost' ? { inputPerMillionTokens: 0, outputPerMillionTokens: 0 } : config.get(k, f)) } as any,
        limiter,
      );
      expect(unpriced.report().totals.estimatedCostUsd).toBeNull();
    });
  });
});
