/**
 * Triage Scoring Configuration
 *
 * Centralises all thresholds, weights, and keyword lists used by the
 * scoring engine so they can be updated without touching service logic.
 *
 * Max theoretical score (ignoring symptom bonus): 30+20+20+25+15 = 110
 * Symptom bonus is capped separately at MAX_SYMPTOM_SCORE.
 */
export const TRIAGE_SCORING_CONFIG = {
  /**
   * Vital sign thresholds (all inclusive boundaries).
   */
  vitals: {
    oxygenLevel: {
      /** SpO₂ % — critically dangerous hypoxemia */
      dangerousLow: 85,
      /** SpO₂ % — clinically significant hypoxemia */
      low: 92,
      /** SpO₂ % — borderline low */
      borderline: 95,
    },
    heartRate: {
      /** bpm — severe bradycardia */
      dangerouslyLow: 40,
      /** bpm — mild bradycardia */
      low: 60,
      /** bpm — tachycardia */
      high: 120,
      /** bpm — severe tachycardia / haemodynamic compromise */
      dangerouslyHigh: 150,
    },
    bloodPressure: {
      systolic: {
        /** mmHg — severe hypotension / shock risk */
        dangerouslyLow: 80,
        /** mmHg — moderate hypotension */
        low: 90,
        /** mmHg — stage 2 hypertension */
        high: 160,
        /** mmHg — hypertensive crisis */
        crisis: 180,
      },
    },
  },

  /**
   * Maximum point contribution per vitals category.
   */
  maxPoints: {
    oxygenLevel: 30,
    heartRate: 20,
    bloodPressure: 20,
    consciousness: 25,
    accidentSeverity: 15,
  },

  /**
   * Maximum bonus points contributed by symptom keyword matches.
   * Each recognised critical keyword adds SYMPTOM_MATCH_BONUS pts.
   */
  symptomKeywords: {
    maxScore: 15,
    pointsPerMatch: 5,
    /** Lower-cased keywords — any partial match triggers the bonus */
    criticalKeywords: [
      'chest pain',
      'difficulty breathing',
      'shortness of breath',
      'not breathing',
      'unconscious',
      'unresponsive',
      'stroke',
      'cardiac arrest',
      'heart attack',
      'severe bleeding',
      'heavy bleeding',
      'seizure',
      'convulsion',
      'choking',
      'airway obstruction',
      'paralysis',
      'severe burn',
    ],
  },

  /**
   * Score boundaries for priority classification.
   * A patient scores ≥ threshold for the given priority.
   */
  priorityThresholds: {
    CRITICAL: 75,
    HIGH: 50,
    MODERATE: 25,
    // Anything below MODERATE threshold = LOW
  },
} as const;
