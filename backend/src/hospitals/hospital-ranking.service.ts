import { Injectable, Logger } from '@nestjs/common';
import { Hospital } from './entities/hospital.entity';
import { HospitalCapability as CapabilityType } from '../common/enums';
import { SeverityLevel } from '../common/enums';
import { GeoPoint, TravelEstimate, TravelTimeService } from '../common/travel-time/travel-time.service';
import { haversineKm } from '../common/geo';
import {
  DEFAULT_RANKING_WEIGHTS,
  DETOUR_TOLERANCE_MINUTES,
  MAX_DISTANCE_KM,
  RankingWeights,
  TRANSPORT_TIME_DECAY_MINUTES,
} from './hospital-ranking.config';

export interface HospitalRankingInput {
  /** Where the patient is — the start of the transport leg before pickup. */
  pickupLatitude: number;
  pickupLongitude: number;

  /**
   * The ambulance's live position, when one is assigned.
   *
   * Used two ways: it becomes the start of the transport leg once the patient
   * is aboard, and before that it decides whether a hospital lies along the
   * ambulance's approach or behind it.
   */
  ambulanceLatitude?: number | null;
  ambulanceLongitude?: number | null;

  /**
   * True once the patient is in the ambulance (a mid-transport reroute). The
   * journey to hospital then starts wherever the ambulance is right now, not
   * at the pickup address it has already left.
   */
  patientOnBoard?: boolean;

  severity?: SeverityLevel;
  emergencyType?: string | null;
}

export interface HospitalScoreBreakdown {
  /** Distance over the transport leg (road distance when routed). */
  distanceKm: number;
  /** Minutes for the transport leg — what the travel-time score is built on. */
  transportMinutes: number;
  /** Where those minutes came from: live traffic, or a distance estimate. */
  travelTimeSource: TravelEstimate['source'];
  /** Extra minutes caused by collecting the patient first. Null before pickup
   *  is relevant, or when the ambulance position is unknown. */
  detourMinutes: number | null;
  travelTimeScore: number;
  approachScore: number;
  icuScore: number;
  bedScore: number;
  specializationScore: number;
  loadScore: number;
}

export interface HospitalScore {
  hospital: Hospital;
  totalScore: number;
  /** One line saying why this hospital ranked where it did. */
  reason: string;
  breakdown: HospitalScoreBreakdown;
}

export interface RankingResult {
  best: Hospital;
  rankedList: HospitalScore[];
  /** Transport minutes to the selected hospital — the ETA to hand downstream. */
  bestEtaMinutes: number;
}

/**
 * HospitalRankingService
 *
 * Chooses where an ambulance should take a patient, from already-loaded
 * Hospital entities. No DB access: callers fetch hospitals with capabilities
 * joined and apply their own eligibility filter first.
 *
 * The ranking is built around the question that actually matters clinically —
 * how long until this patient is receiving the right care — so it scores
 * driving minutes rather than map distance, and takes those minutes from live
 * traffic when a routing key is configured. Two positions feed into it:
 *
 *   - the patient's location, which starts the transport leg before pickup;
 *   - the ambulance's live position, which starts that leg once the patient is
 *     aboard, and which before then reveals whether a hospital is ahead of the
 *     ambulance or back the way it came.
 *
 * Ranking factors (weights in hospital-ranking.config.ts):
 *   Travel time      32% — transport minutes, exponential decay
 *   ICU availability 22% — ICU headroom; heavy penalty for CRITICAL with no ICU
 *   Bed availability 18% — availableBeds / totalBeds
 *   Specialization   15% — capability matched to the emergency type
 *   Approach          8% — detour cost relative to the ambulance's position
 *   Hospital load     5% — aggregate departmental load (tiebreaker)
 */
@Injectable()
export class HospitalRankingService {
  private readonly logger = new Logger(HospitalRankingService.name);

  constructor(private readonly travelTime: TravelTimeService) {}

  /**
   * Select the single best hospital and return the full ranked list.
   *
   * Fallback strategy (never fails dispatch due to missing beds alone):
   *   Pass 1 — eligible hospitals with availableBeds > 0
   *   Pass 2 — all eligible hospitals (beds = 0 is acceptable for alerting)
   */
  async selectBest(
    hospitals: Hospital[],
    input: HospitalRankingInput,
    weights: RankingWeights = DEFAULT_RANKING_WEIGHTS,
  ): Promise<RankingResult | null> {
    if (hospitals.length === 0) {
      this.logger.warn('[HospitalRanking] No hospitals provided — cannot select.');
      return null;
    }

    // Pass 1: prefer hospitals that still have beds
    const withBeds = hospitals.filter(h => (h.availableBeds ?? 0) > 0);
    const candidates = withBeds.length > 0 ? withBeds : hospitals;

    if (withBeds.length === 0) {
      this.logger.warn('[HospitalRanking] Pass 1 found 0 hospitals with beds — falling back to all hospitals.');
    }

    const rankedList = await this.rankAll(candidates, input, weights);
    this.logScoreTable(rankedList, input);

    return {
      best: rankedList[0].hospital,
      rankedList,
      bestEtaMinutes: rankedList[0].breakdown.transportMinutes,
    };
  }

  /**
   * Score and sort all hospitals. Returns highest-score first.
   */
  async rankAll(
    hospitals: Hospital[],
    input: HospitalRankingInput,
    weights: RankingWeights = DEFAULT_RANKING_WEIGHTS,
  ): Promise<HospitalScore[]> {
    const legs = await this.resolveLegs(hospitals, input);

    return hospitals
      .map((hospital, index) => this.scoreOne(hospital, input, weights, legs[index]))
      .sort((a, b) => b.totalScore - a.totalScore);
  }

  // ---------------------------------------------------------------------------
  // Travel legs
  // ---------------------------------------------------------------------------

  /**
   * Work out, for every candidate, how long the transport leg takes and how far
   * out of the ambulance's way it is.
   *
   * Routing is bought once, for a shortlist. The nearest few hospitals by
   * straight line are the only ones whose precise minutes can change the answer;
   * everything beyond that is scored from the offline estimate, which costs
   * nothing and never promotes a distant hospital past a near one on its own.
   */
  private async resolveLegs(
    hospitals: Hospital[],
    input: HospitalRankingInput,
  ): Promise<{ transport: TravelEstimate; detourMinutes: number | null }[]> {
    const pickup: GeoPoint = { latitude: input.pickupLatitude, longitude: input.pickupLongitude };
    const ambulance = this.ambulancePoint(input);

    // Once the patient is aboard, the trip to hospital starts at the ambulance.
    const transportOrigin = input.patientOnBoard && ambulance ? ambulance : pickup;

    const points = hospitals.map(h => this.hospitalPoint(h));

    // Before pickup, a second origin — where the ambulance is — turns "how far
    // is this hospital" into "is it ahead of us or behind us".
    const wantsDetour = Boolean(ambulance) && !input.patientOnBoard;

    // Everything below rides on ONE matrix request: two origins, the shortlisted
    // hospitals, plus the pickup point when the detour needs measuring. Asking
    // leg by leg would multiply a paid call by the number of candidates.
    const budget = this.travelTime.maxDestinationsPerCall;
    const shortlist = this.shortlistIndexes(points, transportOrigin, wantsDetour ? budget - 1 : budget);

    const destinations: GeoPoint[] = shortlist.map(i => points[i]);
    if (wantsDetour) destinations.push(pickup);

    const origins: GeoPoint[] = wantsDetour ? [transportOrigin, ambulance!] : [transportOrigin];
    const matrix = await this.travelTime.estimateMatrix(origins, destinations);

    const transportBySlot = matrix[0] ?? [];
    const ambulanceBySlot = wantsDetour ? matrix[1] ?? [] : [];

    // Ambulance → patient: the same leg for every candidate, and the last
    // destination in the matrix above.
    const ambulanceToPickup = wantsDetour
      ? ambulanceBySlot[destinations.length - 1] ?? this.travelTime.offline(ambulance!, pickup)
      : null;

    return hospitals.map((hospital, index) => {
      const slot = shortlist.indexOf(index);
      const transport = slot >= 0 && transportBySlot[slot]
        ? transportBySlot[slot]
        : this.travelTime.offline(transportOrigin, points[index]);

      let detourMinutes: number | null = null;
      if (ambulanceToPickup) {
        const ambulanceToHospital = slot >= 0 && ambulanceBySlot[slot]
          ? ambulanceBySlot[slot]
          : this.travelTime.offline(ambulance!, points[index]);
        // Time added by picking the patient up on the way. Zero means the
        // hospital sits straight ahead; large means doubling back.
        detourMinutes = Math.max(
          0,
          ambulanceToPickup.minutes + transport.minutes - ambulanceToHospital.minutes,
        );
      }

      return { transport, detourMinutes };
    });
  }

  /** Indexes of the nearest hospitals by straight line, capped for routing cost. */
  private shortlistIndexes(points: GeoPoint[], origin: GeoPoint, maxDestinations: number): number[] {
    return points
      .map((point, index) => ({
        index,
        km: haversineKm(origin.latitude, origin.longitude, point.latitude, point.longitude),
      }))
      // A hospital past the service radius is never worth a paid lookup.
      .filter(entry => entry.km <= MAX_DISTANCE_KM)
      .sort((a, b) => a.km - b.km)
      .slice(0, Math.max(1, maxDestinations))
      .map(entry => entry.index);
  }

  private ambulancePoint(input: HospitalRankingInput): GeoPoint | null {
    const latitude = Number(input.ambulanceLatitude);
    const longitude = Number(input.ambulanceLongitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return { latitude, longitude };
  }

  private hospitalPoint(hospital: Hospital): GeoPoint {
    return { latitude: Number(hospital.latitude), longitude: Number(hospital.longitude) };
  }

  // ---------------------------------------------------------------------------
  // Private scoring helpers
  // ---------------------------------------------------------------------------

  private scoreOne(
    hospital: Hospital,
    input: HospitalRankingInput,
    weights: RankingWeights,
    leg: { transport: TravelEstimate; detourMinutes: number | null },
  ): HospitalScore {
    const travelTimeScore     = this.scoreTravelTime(leg.transport.minutes);
    const approachScore       = this.scoreApproach(leg.detourMinutes);
    const icuScore            = this.scoreIcu(hospital, input.severity);
    const bedScore            = this.scoreBeds(hospital);
    const specializationScore = this.scoreSpecialization(hospital, input.emergencyType);
    const loadScore           = this.scoreLoad(hospital);

    const totalScore =
      weights.travelTime      * travelTimeScore +
      weights.approach        * approachScore +
      weights.icuAvailability * icuScore +
      weights.bedAvailability * bedScore +
      weights.specialization  * specializationScore +
      weights.hospitalLoad    * loadScore;

    const breakdown: HospitalScoreBreakdown = {
      distanceKm: leg.transport.distanceKm,
      transportMinutes: leg.transport.minutes,
      travelTimeSource: leg.transport.source,
      detourMinutes: leg.detourMinutes,
      travelTimeScore,
      approachScore,
      icuScore,
      bedScore,
      specializationScore,
      loadScore,
    };

    return { hospital, totalScore, reason: this.explain(hospital, input, breakdown), breakdown };
  }

  /**
   * Travel-time score: exponential decay over transport minutes.
   *
   * Never reaches 0, so a distant hospital stays selectable when it is the only
   * one that can take the patient.
   */
  private scoreTravelTime(minutes: number): number {
    return Math.max(0.01, Math.exp(-Math.max(0, minutes) / TRANSPORT_TIME_DECAY_MINUTES));
  }

  /**
   * Approach score: how much time is lost by collecting the patient before
   * heading to this hospital, given where the ambulance actually is.
   *
   * Neutral (0.5) when there is no ambulance position to reason from — an
   * unknown position must not advantage or penalise anyone.
   */
  private scoreApproach(detourMinutes: number | null): number {
    if (detourMinutes === null) return 0.5;
    return 1 / (1 + detourMinutes / DETOUR_TOLERANCE_MINUTES);
  }

  /**
   * ICU score.
   * - No ICU capability:  CRITICAL → 0.05 (strong penalty), others → 0.50 (neutral)
   * - ICU not ACCEPTING:  0.20
   * - ICU ACCEPTING:      headroom ratio (available slots / total ICU capacity)
   *                       clamped to [0.10, 1.00] so accepting hospitals are never 0
   */
  private scoreIcu(hospital: Hospital, severity?: SeverityLevel): number {
    const icu = (hospital.capabilities ?? []).find(
      c => c.capabilityType === CapabilityType.ICU,
    );

    if (!icu) {
      return severity === SeverityLevel.CRITICAL ? 0.05 : 0.50;
    }

    if (icu.status !== 'ACCEPTING') return 0.20;

    if (!icu.capacity || icu.capacity <= 0) return 0.60; // has ICU but no capacity data

    const headroom = icu.capacity - (icu.currentLoad ?? 0);
    return Math.min(1, Math.max(0.10, headroom / icu.capacity));
  }

  /**
   * Bed availability score: available / total beds ratio.
   * Returns 0 if totalBeds is unknown — caller's fallback pass handles this.
   */
  private scoreBeds(hospital: Hospital): number {
    if (!hospital.totalBeds || hospital.totalBeds <= 0) return 0;
    return Math.min(1, Math.max(0, (hospital.availableBeds ?? 0) / hospital.totalBeds));
  }

  /**
   * Specialization match score.
   * - No emergencyType provided:               0.50 (neutral — don't penalize)
   * - emergencyType doesn't map to capability: 0.50 (neutral)
   * - Matched capability status ACCEPTING:     1.00
   * - Matched capability status LIMITED:       0.50
   * - Matched capability not ACCEPTING:        0.20
   * - Required capability absent entirely:     0.00
   */
  private scoreSpecialization(hospital: Hospital, emergencyType?: string | null): number {
    if (!emergencyType) return 0.50;

    const required = this.resolveCapability(emergencyType);
    if (!required) return 0.50;

    const cap = (hospital.capabilities ?? []).find(c => c.capabilityType === required);
    if (!cap) return 0.00;

    if (cap.status === 'ACCEPTING') return 1.00;
    if (cap.status === 'LIMITED')   return 0.50;
    return 0.20;
  }

  /**
   * Hospital load score: 1 − (total currentLoad / total capacity) across all capabilities.
   * Returns 0.50 when no load data is available (neutral).
   */
  private scoreLoad(hospital: Hospital): number {
    const caps = hospital.capabilities ?? [];
    if (caps.length === 0) return 0.50;

    let totalCapacity = 0;
    let totalLoad = 0;
    for (const cap of caps) {
      totalCapacity += cap.capacity ?? 0;
      totalLoad     += cap.currentLoad ?? 0;
    }

    if (totalCapacity === 0) return 0.50;
    return Math.max(0, 1 - totalLoad / totalCapacity);
  }

  // ---------------------------------------------------------------------------
  // Explanation
  // ---------------------------------------------------------------------------

  /**
   * A sentence a dispatcher can read: how long, whether the ICU and the
   * specialist unit can take the patient, and whether it is on the way.
   */
  private explain(
    hospital: Hospital,
    input: HospitalRankingInput,
    breakdown: HospitalScoreBreakdown,
  ): string {
    const parts: string[] = [];

    const timing = breakdown.travelTimeSource === 'google' ? 'in current traffic' : 'estimated';
    parts.push(`${breakdown.transportMinutes} min away (${breakdown.distanceKm} km, ${timing})`);

    if (input.severity === SeverityLevel.CRITICAL) {
      parts.push(breakdown.icuScore >= 0.5 ? 'ICU has headroom' : 'limited or no ICU');
    }

    const required = input.emergencyType ? this.resolveCapability(input.emergencyType) : null;
    if (required) {
      parts.push(
        breakdown.specializationScore >= 1 ? `${required} unit accepting`
          : breakdown.specializationScore > 0 ? `${required} unit limited`
          : `no ${required} unit`,
      );
    }

    parts.push(`${hospital.availableBeds ?? 0} beds free`);

    if (breakdown.detourMinutes !== null) {
      parts.push(
        breakdown.detourMinutes <= 2
          ? 'on the ambulance’s route'
          : `${breakdown.detourMinutes} min detour from the ambulance’s position`,
      );
    }

    return parts.join('; ');
  }

  // ---------------------------------------------------------------------------
  // Emergency-type → capability mapping
  // ---------------------------------------------------------------------------

  private readonly KEYWORD_MAP: Array<[string, CapabilityType]> = [
    ['cardiac',   CapabilityType.CARDIAC],
    ['heart',     CapabilityType.CARDIAC],
    ['chest',     CapabilityType.CARDIAC],
    ['trauma',    CapabilityType.TRAUMA],
    ['accident',  CapabilityType.TRAUMA],
    ['injury',    CapabilityType.TRAUMA],
    ['fall',      CapabilityType.TRAUMA],
    ['neuro',     CapabilityType.NEURO],
    ['brain',     CapabilityType.NEURO],
    ['stroke',    CapabilityType.NEURO],
    ['seizure',   CapabilityType.NEURO],
    ['head',      CapabilityType.NEURO],
    ['ob',        CapabilityType.OB],
    ['obstetric', CapabilityType.OB],
    ['pregnancy', CapabilityType.OB],
    ['maternity', CapabilityType.OB],
    ['labor',     CapabilityType.OB],
    ['delivery',  CapabilityType.OB],
  ];

  private resolveCapability(emergencyType: string): CapabilityType | null {
    const lower = emergencyType.toLowerCase();
    for (const [keyword, cap] of this.KEYWORD_MAP) {
      if (lower.includes(keyword)) return cap;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Logging
  // ---------------------------------------------------------------------------

  private logScoreTable(scores: HospitalScore[], input: HospitalRankingInput): void {
    const origin = input.patientOnBoard ? 'ambulance (patient on board)' : 'patient location';
    this.logger.log(
      `[HospitalRanking] Ranked ${scores.length} hospital(s) from ${origin} | ` +
      `severity=${input.severity ?? 'n/a'} emergencyType=${input.emergencyType ?? 'n/a'}`,
    );
    scores.forEach((s, i) => {
      const b = s.breakdown;
      this.logger.log(
        `[HospitalRanking]  #${i + 1} "${s.hospital.name}" ` +
        `TOTAL=${s.totalScore.toFixed(4)} | ` +
        `time=${b.travelTimeScore.toFixed(3)} (${b.transportMinutes}min/${b.distanceKm}km ${b.travelTimeSource}) ` +
        `approach=${b.approachScore.toFixed(3)} (detour=${b.detourMinutes ?? 'n/a'}) ` +
        `icu=${b.icuScore.toFixed(3)} ` +
        `beds=${b.bedScore.toFixed(3)} ` +
        `spec=${b.specializationScore.toFixed(3)} ` +
        `load=${b.loadScore.toFixed(3)}`,
      );
    });
  }
}
