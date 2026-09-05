/**
 * Patient Medical Profile — the single source of truth for a patient's standing
 * clinical background.
 *
 * The four fields live on the patient's own `users` row (see User entity), never
 * on a booking or a triage report. Every consumer — triage, triage summary,
 * hospital pre-arrival alerts, reports — resolves the profile from the patient
 * at read time, so an edit made in the Profile section is immediately reflected
 * everywhere without touching historical records.
 *
 * Every field is optional. A field the patient has not filled in is reported as
 * `null` on the wire and rendered as "Not Provided" — never guessed at, never
 * carried over from another patient or an earlier assumption.
 */

/** Rendered in place of any field the patient has not supplied. */
export const NOT_PROVIDED = 'Not Provided';

/** The subset of a User row the profile is built from. */
export interface MedicalProfileSource {
  bloodType?: string | null;
  allergies?: string | null;
  chronicConditions?: string | null;
  currentMedications?: string | null;
  medicalProfileUpdatedAt?: Date | string | null;
}

/** Values as submitted by a client (create-ID form, profile editor). */
export interface MedicalProfileInput {
  bloodGroup?: string | null;
  allergies?: string | null;
  chronicConditions?: string | null;
  currentMedications?: string | null;
}

export interface MedicalProfile {
  bloodGroup: string | null;
  allergies: string | null;
  chronicConditions: string | null;
  currentMedications: string | null;
  /** Same four fields with "Not Provided" substituted — safe to render directly. */
  display: {
    bloodGroup: string;
    allergies: string;
    chronicConditions: string;
    currentMedications: string;
  };
  /** False when the patient has supplied none of the four fields. */
  hasData: boolean;
  /** When the profile was last saved, ISO-8601, or null if never edited. */
  updatedAt: string | null;
}

/**
 * Trim a submitted value. Blank input means "remove this entry", which is stored
 * as NULL rather than an empty string so reads are unambiguous.
 */
export function normalizeMedicalField(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Build the wire/display shape from a patient row. Accepts null for "no patient resolved". */
export function buildMedicalProfile(source: MedicalProfileSource | null | undefined): MedicalProfile {
  const bloodGroup = normalizeMedicalField(source?.bloodType);
  const allergies = normalizeMedicalField(source?.allergies);
  const chronicConditions = normalizeMedicalField(source?.chronicConditions);
  const currentMedications = normalizeMedicalField(source?.currentMedications);

  const updatedAtRaw = source?.medicalProfileUpdatedAt ?? null;
  const updatedAt = updatedAtRaw
    ? new Date(updatedAtRaw).toISOString()
    : null;

  return {
    bloodGroup,
    allergies,
    chronicConditions,
    currentMedications,
    display: {
      bloodGroup: bloodGroup ?? NOT_PROVIDED,
      allergies: allergies ?? NOT_PROVIDED,
      chronicConditions: chronicConditions ?? NOT_PROVIDED,
      currentMedications: currentMedications ?? NOT_PROVIDED,
    },
    hasData: Boolean(bloodGroup || allergies || chronicConditions || currentMedications),
    updatedAt,
  };
}

/** An empty profile — used when a patient cannot be resolved at all. */
export function emptyMedicalProfile(): MedicalProfile {
  return buildMedicalProfile(null);
}
