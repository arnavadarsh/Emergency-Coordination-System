/**
 * Hospital Ranking Configuration
 *
 * All ranking weights are defined here and must sum to 1.0.
 * Adjust weights to change prioritization without touching ranking logic.
 */

export interface RankingWeights {
  /** 0.35 — closer hospitals reduce transport time and patient risk */
  distance: number;
  /** 0.25 — critical patients frequently need ICU; ICU saturation is a hard constraint */
  icuAvailability: number;
  /** 0.20 — hospital must have room to admit the patient */
  bedAvailability: number;
  /** 0.15 — matching specialization (cardiac, trauma, neuro, OB) improves outcomes */
  specialization: number;
  /** 0.05 — overall departmental load; acts as a tiebreaker between similar hospitals */
  hospitalLoad: number;
}

export const DEFAULT_RANKING_WEIGHTS: RankingWeights = {
  distance: 0.35,
  icuAvailability: 0.25,
  bedAvailability: 0.20,
  specialization: 0.15,
  hospitalLoad: 0.05,
};

/**
 * Hospitals beyond this distance (km) receive a distance score approaching 0.
 * Increase for rural deployments; decrease for dense urban settings.
 */
export const MAX_DISTANCE_KM = 50;
