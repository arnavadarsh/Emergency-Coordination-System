import { TravelTimeService } from './travel-time.service';
import { RateLimiterService } from '../rate-limit/rate-limiter.service';

/**
 * Road times for hospital selection — and the controls that keep a paid maps
 * API from becoming an open tab.
 */
describe('TravelTimeService', () => {
  let limiter: RateLimiterService;
  let settings: Record<string, any>;

  const AMBULANCE = { latitude: 28.5139, longitude: 77.109 };
  const HOSPITAL = { latitude: 28.6139, longitude: 77.209 };

  const config = {
    get: (key: string, fallback?: any) => (key in settings ? settings[key] : fallback),
  };

  const build = () => new TravelTimeService(config as any, limiter);

  const googleResponse = (seconds: number, metres: number) => ({
    ok: true,
    json: async () => ({
      status: 'OK',
      rows: [{ elements: [{ status: 'OK', duration_in_traffic: { value: seconds }, distance: { value: metres } }] }],
    }),
  });

  beforeEach(() => {
    limiter = new RateLimiterService();
    settings = {
      'travelTime.apiKey': '',
      'travelTime.assumedSpeedKmph': 35,
      'travelTime.cacheTtlSeconds': 120,
      'travelTime.maxOrigins': 2,
      'travelTime.maxDestinations': 12,
      'travelTime.limits.perMinute': 60,
      'travelTime.limits.dailyRequests': 5000,
      'travelTime.limits.maxConcurrent': 4,
      'travelTime.limits.timeoutMs': 4000,
      'travelTime.limits.cooldownSeconds': 60,
    };
    global.fetch = jest.fn();
  });

  afterEach(() => {
    limiter.onModuleDestroy();
    jest.restoreAllMocks();
  });

  it('estimates from distance when no routing key is configured, without calling out', async () => {
    const result = await build().estimateOne(AMBULANCE, HOSPITAL);

    expect(result.source).toBe('estimate');
    expect(result.minutes).toBeGreaterThan(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('uses live traffic when a key is configured', async () => {
    settings['travelTime.apiKey'] = 'maps-key';
    (global.fetch as jest.Mock).mockResolvedValue(googleResponse(540, 4200));

    const result = await build().estimateOne(AMBULANCE, HOSPITAL);

    expect(result).toEqual({ minutes: 9, distanceKm: 4.2, source: 'google' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('reuses a recent answer instead of paying twice', async () => {
    settings['travelTime.apiKey'] = 'maps-key';
    (global.fetch as jest.Mock).mockResolvedValue(googleResponse(540, 4200));
    const service = build();

    await service.estimateOne(AMBULANCE, HOSPITAL);
    await service.estimateOne(AMBULANCE, HOSPITAL);

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('falls back to the estimate when the provider fails, and then pauses calling', async () => {
    settings['travelTime.apiKey'] = 'maps-key';
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const service = build();

    const first = await service.estimateOne(AMBULANCE, HOSPITAL);
    expect(first.source).toBe('estimate');

    // Cooldown: the second call must not reach the provider at all.
    const second = await service.estimateOne(AMBULANCE, HOSPITAL);
    expect(second.source).toBe('estimate');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('stops calling once the daily ceiling is spent', async () => {
    settings['travelTime.apiKey'] = 'maps-key';
    settings['travelTime.limits.dailyRequests'] = 1;
    (global.fetch as jest.Mock).mockResolvedValue(googleResponse(540, 4200));
    const service = build();

    await service.estimateOne(AMBULANCE, HOSPITAL);
    // A different pair, so the cache cannot answer it.
    const second = await service.estimateOne(AMBULANCE, { latitude: 28.7, longitude: 77.3 });

    expect(second.source).toBe('estimate');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('refuses to build a matrix larger than configured', async () => {
    settings['travelTime.apiKey'] = 'maps-key';
    settings['travelTime.maxDestinations'] = 2;
    const service = build();

    const result = await service.estimateMatrix([AMBULANCE], [HOSPITAL, HOSPITAL, HOSPITAL]);

    expect(result[0].every(cell => cell.source === 'estimate')).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('estimates just the unreachable cell rather than discarding the matrix', async () => {
    settings['travelTime.apiKey'] = 'maps-key';
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'OK',
        rows: [{
          elements: [
            { status: 'OK', duration: { value: 300 }, distance: { value: 2000 } },
            { status: 'ZERO_RESULTS' },
          ],
        }],
      }),
    });

    const [row] = await build().estimateMatrix([AMBULANCE], [HOSPITAL, { latitude: 28.9, longitude: 77.5 }]);

    expect(row[0].source).toBe('google');
    expect(row[1].source).toBe('estimate');
    expect(row[1].minutes).toBeGreaterThan(0);
  });
});
