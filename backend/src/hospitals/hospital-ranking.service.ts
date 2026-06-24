import { Injectable, Logger } from '@nestjs/common';
import { Hospital } from './entities/hospital.entity';
import { HospitalCapability as CapabilityType } from '../common/enums';
import { SeverityLevel } from '../common/enums';
import {
  DEFAULT_RANKING_WEIGHTS,
  MAX_DISTANCE_KM,
  RankingWeights,
} from './hospital-ranking.config';

export interface HospitalRankingInput {
  pickupLatitude: number;
  pickupLongitude: number;
  severity?: SeverityLevel;
  emergencyType?: string | null;
}

export interface HospitalScoreBreakdown {
  distanceKm: number;
  distanceScore: number;
  icuScore: number;
  bedScore: number;
  specializationScore: number;
  loadScore: number;
}

export interface HospitalScore {
  hospital: Hospital;
  totalScore: number;
  breakdown: HospitalScoreBreakdown;
}

export interface RankingResult {
  best: Hospital;
  rankedList: HospitalScore[];
}

/**
 * HospitalRankingService
 *
 * Pure utility — accepts already-loaded Hospital entities and returns a ranked list.
 * Contains no DB calls; callers are responsible for fetching hospitals with
 * capabilities loaded (eager/explicit join) before calling this service.
 *
 * Ranking factors (configurable via hospital-ranking.config.ts):
 *   Distance         35% — Haversine distance normalized over MAX_DISTANCE_KM
 *   ICU availability 25% — ICU bed headroom; penalizes missing ICU for CRITICAL cases
 *   Bed availability 20% — availableBeds / totalBeds ratio
 *   Specialization   15% — capability type matched to emergencyType keyword
 *   Hospital load     5% — aggregate departmental currentLoad / capacity (tiebreaker)
 */
@Injectable()
export class HospitalRankingService {
  private readonly logger = new Logger(HospitalRankingService.name);

  /**
   * Select the single best hospital and return the full ranked list.
   *
   * Fallback strategy (never fails dispatch due to missing beds alone):
   *   Pass 1 — eligible hospitals with availableBeds > 0
   *   Pass 2 — all eligible hospitals (beds = 0 is acceptable for alerting)
   */
  selectBest(
    hospitals: Hospital[],
    input: HospitalRankingInput,
    weights: RankingWeights = DEFAULT_RANKING_WEIGHTS,
  ): RankingResult | null {
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

    const rankedList = this.rankAll(candidates, input, weights);
    this.logScoreTable(rankedList, input);

    return { best: rankedList[0].hospital, rankedList };
  }

  /**
   * Score and sort all hospitals. Returns highest-score first.
   */
  rankAll(
    hospitals: Hospital[],
    input: HospitalRankingInput,
    weights: RankingWeights = DEFAULT_RANKING_WEIGHTS,
  ): HospitalScore[] {
    return hospitals
      .map(h => this.scoreOne(h, input, weights))
      .sort((a, b) => b.totalScore - a.totalScore);
  }

  // ---------------------------------------------------------------------------
  // Private scoring helpers
  // ---------------------------------------------------------------------------

  private scoreOne(
    hospital: Hospital,
    input: HospitalRankingInput,
    weights: RankingWeights,
  ): HospitalScore {
    const distanceKm = this.haversine(
      input.pickupLatitude,
      input.pickupLongitude,
      Number(hospital.latitude),
      Number(hospital.longitude),
    );

    const distanceScore     = this.scoreDistance(distanceKm);
    const icuScore          = this.scoreIcu(hospital, input.severity);
    const bedScore          = this.scoreBeds(hospital);
    const specializationScore = this.scoreSpecialization(hospital, input.emergencyType);
    const loadScore         = this.scoreLoad(hospital);

    const totalScore =
      weights.distance        * distanceScore +
      weights.icuAvailability * icuScore +
      weights.bedAvailability * bedScore +
      weights.specialization  * specializationScore +
      weights.hospitalLoad    * loadScore;

    return {
      hospital,
      totalScore,
      breakdown: { distanceKm, distanceScore, icuScore, bedScore, specializationScore, loadScore },
    };
  }

  /**
   * Distance score: linear decay from 1.0 at 0 km to 0.0 at MAX_DISTANCE_KM.
   * Hospitals beyond the threshold still receive a small positive score (never 0)
   * so they remain selectable as a last resort.
   */
  private scoreDistance(distanceKm: number): number {
    return Math.max(0.01, 1 - distanceKm / MAX_DISTANCE_KM);
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
    this.logger.log(
      `[HospitalRanking] Ranked ${scores.length} hospital(s) | ` +
      `severity=${input.severity ?? 'n/a'} emergencyType=${input.emergencyType ?? 'n/a'}`,
    );
    scores.forEach((s, i) => {
      const b = s.breakdown;
      this.logger.log(
        `[HospitalRanking]  #${i + 1} "${s.hospital.name}" ` +
        `TOTAL=${s.totalScore.toFixed(4)} | ` +
        `dist=${b.distanceScore.toFixed(3)} (${b.distanceKm.toFixed(1)}km) ` +
        `icu=${b.icuScore.toFixed(3)} ` +
        `beds=${b.bedScore.toFixed(3)} ` +
        `spec=${b.specializationScore.toFixed(3)} ` +
        `load=${b.loadScore.toFixed(3)}`,
      );
    });
  }

  // ---------------------------------------------------------------------------
  // Haversine formula (self-contained — no external dependency)
  // ---------------------------------------------------------------------------

  private haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = this.rad(lat2 - lat1);
    const dLon = this.rad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(this.rad(lat1)) * Math.cos(this.rad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  private rad(deg: number): number {
    return deg * (Math.PI / 180);
  }
}
