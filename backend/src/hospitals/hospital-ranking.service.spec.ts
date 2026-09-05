import { HospitalRankingService } from './hospital-ranking.service';
import { Hospital } from './entities/hospital.entity';
import { HospitalCapability as CapabilityType, SeverityLevel } from '../common/enums';
import { GeoPoint, TravelEstimate } from '../common/travel-time/travel-time.service';
import { haversineKm } from '../common/geo';

/**
 * Where an ambulance takes a patient, given two real positions and the state of
 * each hospital.
 */

type Cap = { capabilityType: CapabilityType; status: string; capacity?: number; currentLoad?: number };

const hospital = (
  name: string,
  latitude: number,
  longitude: number,
  overrides: Partial<Omit<Hospital, 'capabilities'>> & { capabilities?: Cap[] } = {},
): Hospital =>
  ({
    id: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    latitude,
    longitude,
    totalBeds: 100,
    availableBeds: 40,
    capabilities: [],
    ...overrides,
  }) as unknown as Hospital;

/**
 * Stand-in router. Distance-derived by default — same shape as the real offline
 * estimate — with an optional per-destination override so a test can say "this
 * one is slow in traffic" without moving it on the map.
 */
const makeTravelTime = (minutesByName?: (point: GeoPoint) => number | undefined) => {
  const estimate = (origin: GeoPoint, destination: GeoPoint): TravelEstimate => {
    const override = minutesByName?.(destination);
    const distanceKm = haversineKm(origin.latitude, origin.longitude, destination.latitude, destination.longitude);
    return {
      distanceKm: Number(distanceKm.toFixed(2)),
      minutes: override ?? Math.max(1, Math.round((distanceKm / 35) * 60)),
      source: override === undefined ? 'estimate' : 'google',
    };
  };

  return {
    maxDestinationsPerCall: 12,
    offline: estimate,
    estimateOne: jest.fn(async (o: GeoPoint, d: GeoPoint) => estimate(o, d)),
    estimateMatrix: jest.fn(async (origins: GeoPoint[], destinations: GeoPoint[]) =>
      origins.map(o => destinations.map(d => estimate(o, d))),
    ),
  };
};

// Central Delhi. Distances between these are a few km.
const PATIENT = { lat: 28.6139, lng: 77.209 };

describe('HospitalRankingService', () => {
  it('prefers the hospital with the shorter transport time', async () => {
    const travelTime = makeTravelTime();
    const service = new HospitalRankingService(travelTime as any);

    const result = await service.selectBest(
      [hospital('Far General', 28.75, 77.35), hospital('Near General', 28.62, 77.21)],
      { pickupLatitude: PATIENT.lat, pickupLongitude: PATIENT.lng },
    );

    expect(result?.best.name).toBe('Near General');
    expect(result?.bestEtaMinutes).toBeGreaterThan(0);
  });

  it('ranks on minutes, not kilometres — a nearer hospital in bad traffic loses', async () => {
    // "Near General" is closer on the map but 40 minutes away in traffic.
    const travelTime = makeTravelTime(dest => (Math.abs(dest.latitude - 28.62) < 0.001 ? 40 : undefined));
    const service = new HospitalRankingService(travelTime as any);

    const result = await service.selectBest(
      [hospital('Near General', 28.62, 77.21), hospital('Ring Road General', 28.68, 77.28)],
      { pickupLatitude: PATIENT.lat, pickupLongitude: PATIENT.lng },
    );

    expect(result?.best.name).toBe('Ring Road General');
    expect(result?.rankedList[0].breakdown.travelTimeSource).toBe('estimate');
  });

  it('measures the transport leg from the patient before pickup', async () => {
    const travelTime = makeTravelTime();
    const service = new HospitalRankingService(travelTime as any);

    await service.selectBest([hospital('A', 28.62, 77.21)], {
      pickupLatitude: PATIENT.lat,
      pickupLongitude: PATIENT.lng,
      ambulanceLatitude: 28.50,
      ambulanceLongitude: 77.10,
      patientOnBoard: false,
    });

    const [origins] = travelTime.estimateMatrix.mock.calls[0];
    expect(origins[0]).toEqual({ latitude: PATIENT.lat, longitude: PATIENT.lng });
    // The ambulance rides along as a second origin, for the detour measurement.
    expect(origins[1]).toEqual({ latitude: 28.5, longitude: 77.1 });
  });

  it('measures it from the ambulance once the patient is on board', async () => {
    const travelTime = makeTravelTime();
    const service = new HospitalRankingService(travelTime as any);

    await service.selectBest([hospital('A', 28.62, 77.21)], {
      pickupLatitude: PATIENT.lat,
      pickupLongitude: PATIENT.lng,
      ambulanceLatitude: 28.50,
      ambulanceLongitude: 77.10,
      patientOnBoard: true,
    });

    const [origins] = travelTime.estimateMatrix.mock.calls[0];
    expect(origins).toEqual([{ latitude: 28.5, longitude: 77.1 }]);
  });

  it('prefers a hospital ahead of the ambulance over one behind it', async () => {
    // Ambulance approaches from the south-west; the patient is at the centre.
    // Both hospitals are the same distance from the patient, one further along
    // the ambulance's line of travel and one back the way it came.
    const travelTime = makeTravelTime();
    const service = new HospitalRankingService(travelTime as any);

    const ahead = hospital('Ahead General', 28.6639, 77.259);
    const behind = hospital('Behind General', 28.5639, 77.159);

    const result = await service.selectBest([behind, ahead], {
      pickupLatitude: PATIENT.lat,
      pickupLongitude: PATIENT.lng,
      ambulanceLatitude: 28.5139,
      ambulanceLongitude: 77.109,
      patientOnBoard: false,
    });

    expect(result?.best.name).toBe('Ahead General');

    const aheadScore = result!.rankedList.find(s => s.hospital.name === 'Ahead General')!;
    const behindScore = result!.rankedList.find(s => s.hospital.name === 'Behind General')!;
    expect(aheadScore.breakdown.detourMinutes).toBeLessThan(behindScore.breakdown.detourMinutes!);
    expect(aheadScore.breakdown.approachScore).toBeGreaterThan(behindScore.breakdown.approachScore);
  });

  it('stays neutral on approach when no ambulance position is known', async () => {
    const travelTime = makeTravelTime();
    const service = new HospitalRankingService(travelTime as any);

    const result = await service.selectBest([hospital('A', 28.62, 77.21)], {
      pickupLatitude: PATIENT.lat,
      pickupLongitude: PATIENT.lng,
    });

    expect(result?.rankedList[0].breakdown.detourMinutes).toBeNull();
    expect(result?.rankedList[0].breakdown.approachScore).toBe(0.5);
  });

  it('sends a critical cardiac patient past a closer hospital to a capable one', async () => {
    const travelTime = makeTravelTime();
    const service = new HospitalRankingService(travelTime as any);

    const closeButBasic = hospital('Corner Clinic', 28.618, 77.212, { capabilities: [] });
    const fartherSpecialist = hospital('Heart Institute', 28.66, 77.26, {
      capabilities: [
        { capabilityType: CapabilityType.ICU, status: 'ACCEPTING', capacity: 20, currentLoad: 4 },
        { capabilityType: CapabilityType.CARDIAC, status: 'ACCEPTING', capacity: 10, currentLoad: 2 },
      ],
    });

    const result = await service.selectBest([closeButBasic, fartherSpecialist], {
      pickupLatitude: PATIENT.lat,
      pickupLongitude: PATIENT.lng,
      severity: SeverityLevel.CRITICAL,
      emergencyType: 'CARDIAC',
    });

    expect(result?.best.name).toBe('Heart Institute');
  });

  it('still takes the nearest hospital when suitability is equal', async () => {
    const travelTime = makeTravelTime();
    const service = new HospitalRankingService(travelTime as any);

    const caps: Cap[] = [{ capabilityType: CapabilityType.ICU, status: 'ACCEPTING', capacity: 10, currentLoad: 2 }];
    const result = await service.selectBest(
      [hospital('Farther', 28.70, 77.30, { capabilities: caps }), hospital('Closer', 28.62, 77.21, { capabilities: caps })],
      { pickupLatitude: PATIENT.lat, pickupLongitude: PATIENT.lng, severity: SeverityLevel.CRITICAL },
    );

    expect(result?.best.name).toBe('Closer');
  });

  it('falls back to hospitals with no free beds rather than failing a dispatch', async () => {
    const travelTime = makeTravelTime();
    const service = new HospitalRankingService(travelTime as any);

    const result = await service.selectBest(
      [hospital('Full A', 28.62, 77.21, { availableBeds: 0 }), hospital('Full B', 28.70, 77.30, { availableBeds: 0 })],
      { pickupLatitude: PATIENT.lat, pickupLongitude: PATIENT.lng },
    );

    expect(result?.best.name).toBe('Full A');
  });

  it('returns null when there is nothing to choose from', async () => {
    const service = new HospitalRankingService(makeTravelTime() as any);
    expect(await service.selectBest([], { pickupLatitude: PATIENT.lat, pickupLongitude: PATIENT.lng })).toBeNull();
  });

  it('prices the whole ranking with one routing request', async () => {
    const travelTime = makeTravelTime();
    const service = new HospitalRankingService(travelTime as any);

    const hospitals = Array.from({ length: 8 }, (_, i) => hospital(`H${i}`, 28.62 + i * 0.01, 77.21 + i * 0.01));
    await service.selectBest(hospitals, {
      pickupLatitude: PATIENT.lat,
      pickupLongitude: PATIENT.lng,
      ambulanceLatitude: 28.5,
      ambulanceLongitude: 77.1,
    });

    expect(travelTime.estimateMatrix).toHaveBeenCalledTimes(1);
    expect(travelTime.estimateOne).not.toHaveBeenCalled();
  });

  it('shortlists candidates so a long hospital list cannot inflate the routing bill', async () => {
    const travelTime = makeTravelTime();
    const service = new HospitalRankingService(travelTime as any);

    const hospitals = Array.from({ length: 40 }, (_, i) => hospital(`H${i}`, 28.62 + i * 0.002, 77.21));
    const result = await service.selectBest(hospitals, {
      pickupLatitude: PATIENT.lat,
      pickupLongitude: PATIENT.lng,
    });

    const [, destinations] = travelTime.estimateMatrix.mock.calls[0];
    expect(destinations.length).toBeLessThanOrEqual(12);
    // Every hospital is still scored and ranked, shortlisted or not.
    expect(result?.rankedList).toHaveLength(40);
  });

  it('explains its choice in a line a dispatcher can read', async () => {
    const travelTime = makeTravelTime();
    const service = new HospitalRankingService(travelTime as any);

    const result = await service.selectBest(
      [hospital('Heart Institute', 28.62, 77.21, {
        availableBeds: 12,
        capabilities: [
          { capabilityType: CapabilityType.ICU, status: 'ACCEPTING', capacity: 20, currentLoad: 4 },
          { capabilityType: CapabilityType.CARDIAC, status: 'ACCEPTING', capacity: 10, currentLoad: 1 },
        ],
      })],
      {
        pickupLatitude: PATIENT.lat,
        pickupLongitude: PATIENT.lng,
        severity: SeverityLevel.CRITICAL,
        emergencyType: 'CARDIAC',
      },
    );

    const reason = result!.rankedList[0].reason;
    expect(reason).toMatch(/min away/);
    expect(reason).toContain('ICU has headroom');
    expect(reason).toContain('CARDIAC unit accepting');
    expect(reason).toContain('12 beds free');
  });
});
