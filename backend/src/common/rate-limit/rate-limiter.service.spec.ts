import { RateLimiterService } from './rate-limiter.service';

/**
 * The counter that stands between an open endpoint and an unbounded bill.
 */
describe('RateLimiterService', () => {
  let limiter: RateLimiterService;

  beforeEach(() => {
    jest.useFakeTimers();
    limiter = new RateLimiterService();
  });

  afterEach(() => {
    limiter.onModuleDestroy();
    jest.useRealTimers();
  });

  const policy = { limit: 3, windowMs: 60_000 };

  it('allows up to the limit, then refuses', () => {
    for (let i = 0; i < 3; i++) {
      expect(limiter.consume('b', 'caller', policy).allowed).toBe(true);
    }
    const refused = limiter.consume('b', 'caller', policy);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('counts each caller separately', () => {
    for (let i = 0; i < 3; i++) limiter.consume('b', 'caller-a', policy);
    expect(limiter.consume('b', 'caller-a', policy).allowed).toBe(false);
    expect(limiter.consume('b', 'caller-b', policy).allowed).toBe(true);
  });

  it('keeps separate counts per bucket', () => {
    for (let i = 0; i < 3; i++) limiter.consume('bucket-1', 'caller', policy);
    expect(limiter.consume('bucket-1', 'caller', policy).allowed).toBe(false);
    expect(limiter.consume('bucket-2', 'caller', policy).allowed).toBe(true);
  });

  it('does not count a refused request, so hammering cannot extend the wait', () => {
    for (let i = 0; i < 3; i++) limiter.consume('b', 'caller', policy);

    const first = limiter.consume('b', 'caller', policy);
    jest.advanceTimersByTime(30_000);
    for (let i = 0; i < 50; i++) limiter.consume('b', 'caller', policy);
    const later = limiter.consume('b', 'caller', policy);

    // 30s elapsed, so the wait should have shrunk by ~30s, not grown.
    expect(later.retryAfterSeconds).toBeLessThan(first.retryAfterSeconds);
  });

  it('frees capacity as the window rolls forward, not all at once', () => {
    limiter.consume('b', 'caller', policy);
    jest.advanceTimersByTime(30_000);
    limiter.consume('b', 'caller', policy);
    limiter.consume('b', 'caller', policy);
    expect(limiter.consume('b', 'caller', policy).allowed).toBe(false);

    // The first request ages out; exactly one slot returns.
    jest.advanceTimersByTime(30_001);
    expect(limiter.consume('b', 'caller', policy).allowed).toBe(true);
    expect(limiter.consume('b', 'caller', policy).allowed).toBe(false);
  });

  it('treats a limit of zero as "this path is off"', () => {
    expect(limiter.consume('b', 'caller', { limit: 0, windowMs: 1000 }).allowed).toBe(false);
  });

  it('peek reports the decision without spending an allowance', () => {
    expect(limiter.peek('b', 'caller', policy).allowed).toBe(true);
    expect(limiter.peek('b', 'caller', policy).allowed).toBe(true);
    expect(limiter.used('b', 'caller', policy.windowMs)).toBe(0);
  });

  it('reports what a caller has used in the window', () => {
    limiter.consume('b', 'caller', policy);
    limiter.consume('b', 'caller', policy);
    expect(limiter.used('b', 'caller', policy.windowMs)).toBe(2);
  });

  describe('concurrency slots', () => {
    it('hands out no more than the maximum, and reuses released ones', () => {
      expect(limiter.tryAcquireSlot('gemini', 2)).toBe(true);
      expect(limiter.tryAcquireSlot('gemini', 2)).toBe(true);
      expect(limiter.tryAcquireSlot('gemini', 2)).toBe(false);

      limiter.releaseSlot('gemini');
      expect(limiter.activeSlots('gemini')).toBe(1);
      expect(limiter.tryAcquireSlot('gemini', 2)).toBe(true);
    });

    it('never drops below zero when released more than acquired', () => {
      limiter.releaseSlot('gemini');
      expect(limiter.activeSlots('gemini')).toBe(0);
    });
  });
});
