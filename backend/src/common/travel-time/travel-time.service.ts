import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RateLimiterService } from '../rate-limit/rate-limiter.service';
import { estimateMinutes, haversineKm } from '../geo';

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface TravelEstimate {
  /** Road distance when known, straight-line distance otherwise. */
  distanceKm: number;
  /** Driving minutes, in live traffic when the routing provider is configured. */
  minutes: number;
  /** 'google' — real road/traffic data. 'estimate' — derived from distance. */
  source: 'google' | 'estimate';
}

const BUCKET = 'travel-time';
const GLOBAL_KEY = 'all';
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 3600_000;

/**
 * TravelTimeService
 *
 * Answers "how long, by road, from here to there" — the number hospital
 * selection is really ranking on, since what matters clinically is the minutes
 * the patient spends in the ambulance, not the kilometres on a straight line.
 *
 * Two sources, one interface:
 *   - Google Distance Matrix, with live traffic, when a key is configured. One
 *     request covers every origin/destination pair, so ranking N hospitals from
 *     2 origins costs one call, not 2N.
 *   - Otherwise a distance-derived estimate using the same assumed speed as the
 *     tracking views, so a deployment without a key still ranks sensibly and no
 *     two screens disagree about an ETA.
 *
 * Being a paid API reached from an automatic dispatch path, it carries the same
 * controls as the LLM: a short-lived cache, rate and daily ceilings, a
 * concurrency cap, a deadline, and a cooldown after an upstream rejection.
 * Every failure falls back to the estimate — hospital selection must not stop
 * because a maps API is unhappy.
 */
@Injectable()
export class TravelTimeService {
  private readonly logger = new Logger(TravelTimeService.name);

  /** cache key → estimate + expiry. Bounded by MAX_CACHE_ENTRIES. */
  private readonly cache = new Map<string, { value: TravelEstimate; expiresAt: number }>();
  private static readonly MAX_CACHE_ENTRIES = 5000;

  private cooldownUntil = 0;

  constructor(
    private readonly configService: ConfigService,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  get isLiveRoutingConfigured(): boolean {
    return Boolean(this.configService.get<string>('travelTime.apiKey'));
  }

  /** Destinations that may share one matrix request — callers shortlist to this. */
  get maxDestinationsPerCall(): number {
    return this.configService.get<number>('travelTime.maxDestinations', 12);
  }

  /** Travel from one point to one destination. */
  async estimateOne(origin: GeoPoint, destination: GeoPoint): Promise<TravelEstimate> {
    const [row] = await this.estimateMatrix([origin], [destination]);
    return row[0];
  }

  /** Travel from one point to many destinations, in a single upstream call. */
  async estimateMany(origin: GeoPoint, destinations: GeoPoint[]): Promise<TravelEstimate[]> {
    const [row] = await this.estimateMatrix([origin], destinations);
    return row;
  }

  /**
   * Full matrix: `result[i][j]` is the trip from `origins[i]` to
   * `destinations[j]`. Ranking uses two origins — the ambulance and the patient
   * — so that both the transport leg and the detour the ambulance would make
   * are known from the same call.
   */
  async estimateMatrix(origins: GeoPoint[], destinations: GeoPoint[]): Promise<TravelEstimate[][]> {
    if (origins.length === 0 || destinations.length === 0) return [];

    const fallback = () => origins.map(origin => destinations.map(dest => this.offline(origin, dest)));

    if (!this.canCallProvider(origins.length, destinations.length)) {
      return fallback();
    }

    const cached = this.readCache(origins, destinations);
    if (cached) return cached;

    if (!this.rateLimiter.tryAcquireSlot(BUCKET, this.limit('maxConcurrent'))) {
      this.logger.warn('[travel-time] Concurrency cap reached — using the offline estimate');
      return fallback();
    }

    try {
      const matrix = await this.fetchFromGoogle(origins, destinations);
      if (!matrix) return fallback();

      this.rateLimiter.consume(BUCKET + ':minute', GLOBAL_KEY, { limit: this.limit('perMinute'), windowMs: MINUTE_MS });
      this.rateLimiter.consume(BUCKET + ':day', GLOBAL_KEY, { limit: this.limit('dailyRequests'), windowMs: DAY_MS });
      this.writeCache(origins, destinations, matrix);
      return matrix;
    } catch (error: any) {
      this.startCooldown(error?.message ?? String(error));
      return fallback();
    } finally {
      this.rateLimiter.releaseSlot(BUCKET);
    }
  }

  // ── Provider gate ─────────────────────────────────────────────────────────

  private limit(name: string): number {
    return this.configService.get<number>(`travelTime.limits.${name}`, 0);
  }

  /** Whether a live call is permitted right now, for size, budget and health. */
  private canCallProvider(originCount: number, destinationCount: number): boolean {
    if (!this.isLiveRoutingConfigured) return false;

    if (Date.now() < this.cooldownUntil) return false;

    // Matrix billing is per pair — refuse to build one bigger than configured
    // rather than quietly sending an expensive request.
    if (originCount > this.configService.get<number>('travelTime.maxOrigins', 2)) return false;
    if (destinationCount > this.configService.get<number>('travelTime.maxDestinations', 12)) return false;

    if (!this.rateLimiter.peek(BUCKET + ':minute', GLOBAL_KEY, { limit: this.limit('perMinute'), windowMs: MINUTE_MS }).allowed) {
      this.logger.warn('[travel-time] Per-minute ceiling reached — using the offline estimate');
      return false;
    }

    if (!this.rateLimiter.peek(BUCKET + ':day', GLOBAL_KEY, { limit: this.limit('dailyRequests'), windowMs: DAY_MS }).allowed) {
      this.logger.warn('[travel-time] Daily ceiling reached — using the offline estimate');
      return false;
    }

    return true;
  }

  private startCooldown(reason: string): void {
    const seconds = this.limit('cooldownSeconds') || 60;
    this.cooldownUntil = Date.now() + seconds * 1000;
    this.logger.warn(`[travel-time] Provider call failed — pausing for ${seconds}s: ${reason}`);
  }

  // ── Google Distance Matrix ────────────────────────────────────────────────

  private async fetchFromGoogle(origins: GeoPoint[], destinations: GeoPoint[]): Promise<TravelEstimate[][] | null> {
    const params = new URLSearchParams({
      origins: origins.map(p => `${p.latitude},${p.longitude}`).join('|'),
      destinations: destinations.map(p => `${p.latitude},${p.longitude}`).join('|'),
      mode: 'driving',
      departure_time: 'now',
      traffic_model: 'best_guess',
      key: this.configService.get<string>('travelTime.apiKey', ''),
    });

    const response = await fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?${params}`, {
      signal: AbortSignal.timeout(this.limit('timeoutMs') || 4000),
    });

    if (!response.ok) throw new Error(`Distance Matrix HTTP ${response.status}`);

    const data: any = await response.json();
    if (data?.status !== 'OK') throw new Error(`Distance Matrix status ${data?.status}`);

    return origins.map((origin, i) =>
      destinations.map((destination, j) => {
        const element = data?.rows?.[i]?.elements?.[j];
        const seconds = Number(element?.duration_in_traffic?.value ?? element?.duration?.value);
        const metres = Number(element?.distance?.value);

        // One unreachable pair (an island, a bad coordinate) must not discard
        // the whole matrix — estimate just that cell.
        if (element?.status !== 'OK' || !Number.isFinite(seconds) || seconds <= 0) {
          return this.offline(origin, destination);
        }

        return {
          minutes: Math.max(1, Math.round(seconds / 60)),
          distanceKm: Number.isFinite(metres) ? Number((metres / 1000).toFixed(2)) : haversineKm(
            origin.latitude, origin.longitude, destination.latitude, destination.longitude,
          ),
          source: 'google' as const,
        };
      }),
    );
  }

  // ── Offline estimate ──────────────────────────────────────────────────────

  /**
   * Straight-line distance at an assumed average speed — the same model the
   * patient's tracking view and the public tracking page use, so a hospital's
   * ranked ETA and the ETA a family sees come from one formula.
   *
   * Public and synchronous on purpose: callers ranking a long tail of distant
   * candidates can price them without paying for a routing call that would not
   * change the outcome.
   */
  offline(origin: GeoPoint, destination: GeoPoint): TravelEstimate {
    const distanceKm = haversineKm(origin.latitude, origin.longitude, destination.latitude, destination.longitude);
    const speed = this.configService.get<number>('travelTime.assumedSpeedKmph', 35);
    return {
      distanceKm: Number(distanceKm.toFixed(2)),
      minutes: estimateMinutes(distanceKm, speed),
      source: 'estimate',
    };
  }

  // ── Cache ─────────────────────────────────────────────────────────────────

  /** ~110 m of precision: enough to reuse a result for a moving ambulance. */
  private pointKey(point: GeoPoint): string {
    return `${point.latitude.toFixed(3)},${point.longitude.toFixed(3)}`;
  }

  private cellKey(origin: GeoPoint, destination: GeoPoint): string {
    return `${this.pointKey(origin)}>${this.pointKey(destination)}`;
  }

  private readCache(origins: GeoPoint[], destinations: GeoPoint[]): TravelEstimate[][] | null {
    const now = Date.now();
    const out: TravelEstimate[][] = [];

    for (const origin of origins) {
      const row: TravelEstimate[] = [];
      for (const destination of destinations) {
        const hit = this.cache.get(this.cellKey(origin, destination));
        // Partial hits are not worth stitching together: the matrix is one call
        // either way, so anything missing means making it.
        if (!hit || hit.expiresAt <= now) return null;
        row.push(hit.value);
      }
      out.push(row);
    }
    return out;
  }

  private writeCache(origins: GeoPoint[], destinations: GeoPoint[], matrix: TravelEstimate[][]): void {
    const ttl = this.configService.get<number>('travelTime.cacheTtlSeconds', 120) * 1000;
    const expiresAt = Date.now() + ttl;

    if (this.cache.size > TravelTimeService.MAX_CACHE_ENTRIES) this.cache.clear();

    origins.forEach((origin, i) =>
      destinations.forEach((destination, j) => {
        this.cache.set(this.cellKey(origin, destination), { value: matrix[i][j], expiresAt });
      }),
    );
  }
}
