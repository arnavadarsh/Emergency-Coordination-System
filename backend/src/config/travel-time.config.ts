import { registerAs } from '@nestjs/config';

const int = (value: string | undefined, fallback: number): number => {
  const parsed = parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const float = (value: string | undefined, fallback: number): number => {
  const parsed = parseFloat(value ?? '');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * Road travel times, used to rank hospitals by how long the patient would
 * actually be in the ambulance.
 *
 * With GOOGLE_MAPS_API_KEY set, times come from the Distance Matrix API with
 * live traffic. Without it, they are derived from straight-line distance at an
 * assumed speed — good enough to order candidates, and identical to the model
 * the tracking views already use, so the two never disagree.
 *
 * The limits mirror the Gemini ones and exist for the same reason: this is a
 * paid API called from a dispatch path that runs without human review.
 */
export default registerAs('travelTime', () => ({
  apiKey: process.env.GOOGLE_MAPS_API_KEY || '',

  /** Seconds a matrix result stays usable. Traffic does not change in seconds,
   *  and a repeat dispatch from the same area should not pay twice. */
  cacheTtlSeconds: int(process.env.TRAVEL_TIME_CACHE_TTL_SECONDS, 120),

  /** Distance Matrix bills per origin-destination pair; keep matrices small. */
  maxOrigins: int(process.env.TRAVEL_TIME_MAX_ORIGINS, 2),
  maxDestinations: int(process.env.TRAVEL_TIME_MAX_DESTINATIONS, 12),

  limits: {
    perMinute: int(process.env.TRAVEL_TIME_PER_MINUTE, 60),
    dailyRequests: int(process.env.TRAVEL_TIME_DAILY_REQUESTS, 5000),
    maxConcurrent: int(process.env.TRAVEL_TIME_MAX_CONCURRENT, 4),
    timeoutMs: int(process.env.TRAVEL_TIME_TIMEOUT_MS, 4000),
    /** Pause after an upstream rejection, so a quota error is not retried hard. */
    cooldownSeconds: int(process.env.TRAVEL_TIME_COOLDOWN_SECONDS, 60),
  },

  /** Assumed average road speed for the offline estimate, km/h. */
  assumedSpeedKmph: float(process.env.TRAVEL_TIME_ASSUMED_SPEED_KMPH, 35),
}));
