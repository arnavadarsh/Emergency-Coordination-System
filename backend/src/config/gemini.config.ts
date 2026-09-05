import { registerAs } from '@nestjs/config';

const int = (value: string | undefined, fallback: number): number => {
  const parsed = parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const float = (value: string | undefined, fallback: number): number => {
  const parsed = parseFloat(value ?? '');
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

/**
 * Gemini access and the controls around it.
 *
 * The triage conversation endpoint is reachable without a login (a bystander
 * mid-emergency has no account), so every one of these limits stands between a
 * runaway client — or someone deliberately hammering the endpoint — and a bill
 * nobody approved. Each is independently tunable, and setting any to 0 turns
 * that call path off.
 */
export default registerAs('gemini', () => ({
  apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '',
  model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',

  limits: {
    /** Per caller (signed-in user, else IP), enforced at the HTTP edge. */
    perCallerPerMinute: int(process.env.GEMINI_PER_CALLER_PER_MINUTE, 15),
    /** Across everyone — the ceiling on how fast money can leave. */
    globalPerMinute: int(process.env.GEMINI_GLOBAL_PER_MINUTE, 90),
    /** Hard stop for a 24-hour rolling period. */
    dailyRequests: int(process.env.GEMINI_DAILY_REQUESTS, 3000),
    /**
     * Token budget for the same period. Tokens, not requests, are what
     * actually get billed, so this is the limit that tracks cost even if the
     * transcripts get longer.
     */
    dailyTokens: int(process.env.GEMINI_DAILY_TOKENS, 3_000_000),
    /** Simultaneous in-flight calls; stops a burst from piling up. */
    maxConcurrent: int(process.env.GEMINI_MAX_CONCURRENT, 4),
    /** Deadline for a single call. Triage must never hang behind the model. */
    timeoutMs: int(process.env.GEMINI_TIMEOUT_MS, 12_000),
    /** Conversation turns sent upstream; the middle is dropped beyond this. */
    maxMessages: int(process.env.GEMINI_MAX_MESSAGES, 40),
    /** Characters of transcript sent upstream — the direct input-cost lever. */
    maxTranscriptChars: int(process.env.GEMINI_MAX_TRANSCRIPT_CHARS, 12_000),
    /**
     * How long to stop calling Gemini after it rejects us for quota. Being
     * told to slow down and then retrying immediately is how a quota problem
     * becomes a billing problem.
     */
    throttleCooldownSeconds: int(process.env.GEMINI_THROTTLE_COOLDOWN_SECONDS, 60),
    /** Cooldown after repeated upstream failures (transient overload). */
    errorCooldownSeconds: int(process.env.GEMINI_ERROR_COOLDOWN_SECONDS, 15),
  },

  /**
   * Used only to turn observed token counts into an approximate spend figure
   * for the usage endpoint. Defaults reflect published gemini-2.5-flash pricing
   * at the time of writing — check them against current pricing, and set both
   * to 0 to hide the estimate.
   */
  cost: {
    inputPerMillionTokens: float(process.env.GEMINI_INPUT_COST_PER_MTOK, 0.3),
    outputPerMillionTokens: float(process.env.GEMINI_OUTPUT_COST_PER_MTOK, 2.5),
  },
}));
