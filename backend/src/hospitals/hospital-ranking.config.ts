/**
 * Hospital Ranking Configuration
 *
 * All ranking weights are defined here and must sum to 1.0.
 * Adjust weights to change prioritization without touching ranking logic.
 */

export interface RankingWeights {
  /** 0.32 — minutes the patient will spend in the ambulance on the way to care */
  travelTime: number;
  /** 0.22 — critical patients frequently need ICU; ICU saturation is a hard constraint */
  icuAvailability: number;
  /** 0.18 — hospital must have room to admit the patient */
  bedAvailability: number;
  /** 0.15 — matching specialization (cardiac, trauma, neuro, OB) improves outcomes */
  specialization: number;
  /** 0.08 — whether the hospital lies along the ambulance's approach, or behind it */
  approach: number;
  /** 0.05 — overall departmental load; acts as a tiebreaker between similar hospitals */
  hospitalLoad: number;
}

export const DEFAULT_RANKING_WEIGHTS: RankingWeights = {
  travelTime: 0.32,
  icuAvailability: 0.22,
  bedAvailability: 0.18,
  specialization: 0.15,
  approach: 0.08,
  hospitalLoad: 0.05,
};

/**
 * Half-life of the transport-time score, in minutes.
 *
 * Time is scored on an exponential decay rather than a straight line because
 * the clinical value of saving minutes is not flat: the gap between a 5-minute
 * and a 12-minute transport matters far more than the gap between 40 and 47.
 * At 0 minutes the score is 1.0; at this value ≈0.37; at twice it ≈0.14.
 *
 * Raise it for rural deployments where every hospital is far away and the
 * ranking would otherwise flatten to nothing.
 */
export const TRANSPORT_TIME_DECAY_MINUTES = 15;

/**
 * Detour tolerance, in minutes.
 *
 * A hospital's "approach" score reflects how much time is lost by collecting
 * the patient first, compared with the ambulance driving straight there — which
 * is what tells a hospital ahead of the ambulance from one behind it. A detour
 * of this many minutes scores 0.5.
 */
export const DETOUR_TOLERANCE_MINUTES = 10;

/**
 * Beyond this straight-line distance (km) a hospital is treated as an outlier:
 * still selectable as a last resort, but never worth a paid routing lookup.
 * Increase for rural deployments; decrease for dense urban settings.
 */
export const MAX_DISTANCE_KM = 50;
