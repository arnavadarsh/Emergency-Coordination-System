/**
 * Patient Medical Profile — shared client model.
 *
 * The profile lives on the patient's own profile record and is the single source
 * of truth: ID creation, the Profile section, triage, the triage summary,
 * hospital pre-alerts and reports all show these same values, resolved from the
 * server at read time.
 *
 * Every field is optional. Anything the patient has not supplied is rendered as
 * "Not Provided" — never guessed, never carried over from elsewhere.
 */

export const NOT_PROVIDED = 'Not Provided';

/** Blood groups offered in the pickers. Matches the backend's stored width. */
export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;

export type MedicalProfileField =
  | 'bloodGroup'
  | 'allergies'
  | 'chronicConditions'
  | 'currentMedications';

/** Label + icon per field, so every screen presents the profile identically. */
export const MEDICAL_PROFILE_FIELDS: {
  key: MedicalProfileField;
  label: string;
  icon: string;
  placeholder: string;
  /** Long free text gets a textarea; blood group gets a select. */
  input: 'select' | 'text' | 'textarea';
}[] = [
  { key: 'bloodGroup', label: 'Blood Group', icon: '🩸', placeholder: 'e.g. O+', input: 'select' },
  { key: 'allergies', label: 'Allergies', icon: '⚠️', placeholder: 'e.g. Penicillin', input: 'textarea' },
  { key: 'chronicConditions', label: 'Chronic Conditions', icon: '🏥', placeholder: 'e.g. Asthma', input: 'textarea' },
  { key: 'currentMedications', label: 'Current Medications', icon: '💊', placeholder: 'e.g. Salbutamol', input: 'textarea' },
];

export interface MedicalProfile {
  bloodGroup: string | null;
  allergies: string | null;
  chronicConditions: string | null;
  currentMedications: string | null;
  /** The same four fields with "Not Provided" already substituted. */
  display: Record<MedicalProfileField, string>;
  /** False when none of the four fields has been supplied. */
  hasData: boolean;
  updatedAt: string | null;
}

/** Editable form values — always strings, "" meaning "not set / remove". */
export type MedicalProfileForm = Record<MedicalProfileField, string>;

export const EMPTY_MEDICAL_PROFILE_FORM: MedicalProfileForm = {
  bloodGroup: '',
  allergies: '',
  chronicConditions: '',
  currentMedications: '',
};

const clean = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
};

/**
 * Coerce whatever the server (or a socket event) sent into a complete profile.
 *
 * Tolerates a missing `display` block and a missing profile altogether, so a
 * screen never has to branch on shape — an absent profile simply renders as four
 * "Not Provided" rows.
 */
export function normalizeMedicalProfile(raw: any): MedicalProfile {
  const bloodGroup = clean(raw?.bloodGroup ?? raw?.bloodType);
  const allergies = clean(raw?.allergies);
  const chronicConditions = clean(raw?.chronicConditions);
  const currentMedications = clean(raw?.currentMedications);

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
    updatedAt: clean(raw?.updatedAt),
  };
}

/** Prefill an editor from a saved profile. */
export function toMedicalProfileForm(profile: MedicalProfile | null | undefined): MedicalProfileForm {
  if (!profile) return { ...EMPTY_MEDICAL_PROFILE_FORM };
  return {
    bloodGroup: profile.bloodGroup ?? '',
    allergies: profile.allergies ?? '',
    chronicConditions: profile.chronicConditions ?? '',
    currentMedications: profile.currentMedications ?? '',
  };
}

/**
 * Payload for a save. Blank fields are sent as "" on purpose — that is how the
 * API is told to remove information that is no longer accurate.
 */
export function toMedicalProfilePayload(form: MedicalProfileForm) {
  return {
    bloodGroup: form.bloodGroup.trim(),
    allergies: form.allergies.trim(),
    chronicConditions: form.chronicConditions.trim(),
    currentMedications: form.currentMedications.trim(),
  };
}

/** True when the form holds nothing at all — used to label the section as empty. */
export function isMedicalProfileFormEmpty(form: MedicalProfileForm): boolean {
  return MEDICAL_PROFILE_FIELDS.every(f => form[f.key].trim() === '');
}

/**
 * Risks a responder should not have to read the whole panel to notice.
 * Empty when the patient recorded no allergies, conditions or medications.
 */
export function medicalProfileAlerts(profile: MedicalProfile): string[] {
  const alerts: string[] = [];
  if (profile.allergies) alerts.push(`Allergy: ${profile.allergies}`);
  if (profile.chronicConditions) alerts.push(`Condition: ${profile.chronicConditions}`);
  if (profile.currentMedications) alerts.push(`Medication: ${profile.currentMedications}`);
  return alerts;
}
