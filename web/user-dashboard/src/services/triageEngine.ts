// ============================================================================
// Triage Engine — Pure TypeScript Decision Tree + Inference Engine
// ============================================================================
// A client-side state machine that drives the 7-step emergency triage protocol.
// No external AI APIs required. Deterministic rule-based inference.
// ============================================================================

export type SeverityLevel = 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW';

export type QuestionType = 'yes_no' | 'multiple_choice' | 'pain_scale' | 'text';

export type EmergencyType = 'cardiac' | 'stroke' | 'trauma' | 'respiratory' | 'neurological' | 'obstetric' | 'other';

export interface TriageQuestion {
  id: string;
  step: number;
  text: string;
  subtext?: string;
  type: QuestionType;
  options?: string[];
  getNext: (answer: string, state: TriageState) => string | null;  // null = done
}

export interface AmbulanceRequirements {
  type: 'BLS' | 'ALS' | 'ICU' | 'NEONATAL';
  equipment: string[];
  staff: string[];
}

export interface HospitalRecommendation {
  type: string;
  requiredUnits: string[];
  reason: string;
}

export interface TriageResult {
  severity: SeverityLevel;
  emergencyType: EmergencyType;
  ambulance: AmbulanceRequirements;
  hospital: HospitalRecommendation;
  reasoning: string[];
  chiefComplaint: string;
  isBreathing: boolean;
  isConscious: boolean;
  hasChestPain: boolean;
  hasSevereBleeding: boolean;
  painLevel: number;
  isPregnant: boolean;
  answers: Record<string, string>;
}

export interface TriageState {
  answers: Record<string, string>;
  severity: SeverityLevel;
  emergencyType: EmergencyType;
  equipment: string[];
  staff: string[];
  reasoning: string[];
  hospitalUnits: string[];
}

// ────────────────────────────────────────────────────────────────────────────
// DECISION TREE — Each question has conditional next-question logic
// ────────────────────────────────────────────────────────────────────────────

const QUESTIONS: Record<string, TriageQuestion> = {
  // ── STEP 1: Critical Condition Checks ──────────────────────────────────
  breathing: {
    id: 'breathing',
    step: 1,
    text: 'Is the patient currently breathing?',
    subtext: 'Check for visible chest movement or breath sounds',
    type: 'yes_no',
    getNext: (_answer) => {
      // Regardless, move to consciousness check
      return 'conscious';
    },
  },

  conscious: {
    id: 'conscious',
    step: 1,
    text: 'Is the patient conscious and responsive?',
    subtext: 'Can they respond to voice or touch?',
    type: 'yes_no',
    getNext: (_answer) => {
      return 'bleeding';
    },
  },

  bleeding: {
    id: 'bleeding',
    step: 1,
    text: 'Is there severe or uncontrolled bleeding?',
    subtext: 'Bleeding that cannot be stopped with direct pressure',
    type: 'yes_no',
    getNext: () => {
      return 'emergency_type';
    },
  },

  // ── STEP 2: Emergency Type Identification ──────────────────────────────
  emergency_type: {
    id: 'emergency_type',
    step: 2,
    text: 'What best describes the emergency?',
    subtext: 'Select the most relevant category',
    type: 'multiple_choice',
    options: [
      'Chest pain / Heart problem',
      'Stroke symptoms (face drooping, arm weakness, speech difficulty)',
      'Accident / Injury / Trauma',
      'Breathing difficulty / Respiratory distress',
      'Seizure / Neurological issue',
      'Pregnancy / Childbirth complication',
      'Other medical emergency',
    ],
    getNext: (answer) => {
      if (answer.startsWith('Chest pain')) return 'chest_pain_type';
      if (answer.startsWith('Stroke')) return 'stroke_onset';
      if (answer.startsWith('Accident')) return 'trauma_type';
      if (answer.startsWith('Breathing')) return 'breathing_detail';
      if (answer.startsWith('Seizure')) return 'seizure_status';
      if (answer.startsWith('Pregnancy')) return 'pregnancy_week';
      return 'chief_complaint';
    },
  },

  // ── STEP 3: Conditional Follow-ups ─────────────────────────────────────

  // Cardiac follow-ups
  chest_pain_type: {
    id: 'chest_pain_type',
    step: 3,
    text: 'How would you describe the chest pain?',
    type: 'multiple_choice',
    options: [
      'Crushing / Squeezing pressure',
      'Sharp / Stabbing pain',
      'Burning sensation',
      'Tightness with shortness of breath',
      'Radiating to arm, jaw, or back',
    ],
    getNext: () => 'chest_pain_duration',
  },

  chest_pain_duration: {
    id: 'chest_pain_duration',
    step: 3,
    text: 'How long has the chest pain lasted?',
    type: 'multiple_choice',
    options: [
      'Just started (less than 5 minutes)',
      '5–30 minutes',
      'More than 30 minutes',
      'Comes and goes over hours',
    ],
    getNext: () => 'pain_level',
  },

  // Stroke follow-ups
  stroke_onset: {
    id: 'stroke_onset',
    step: 3,
    text: 'When did the stroke symptoms start?',
    subtext: 'This is critical for treatment decisions',
    type: 'multiple_choice',
    options: [
      'Within the last hour',
      '1–3 hours ago',
      '3–6 hours ago',
      'More than 6 hours ago',
      'Unknown / Woke up with symptoms',
    ],
    getNext: () => 'stroke_symptoms',
  },

  stroke_symptoms: {
    id: 'stroke_symptoms',
    step: 3,
    text: 'Which symptoms are present?',
    type: 'multiple_choice',
    options: [
      'Face drooping on one side',
      'Arm weakness / Cannot lift both arms',
      'Speech difficulty / Slurred speech',
      'Sudden severe headache',
      'Vision problems',
      'Multiple of the above',
    ],
    getNext: () => 'pain_level',
  },

  // Trauma follow-ups
  trauma_type: {
    id: 'trauma_type',
    step: 3,
    text: 'What type of trauma / injury occurred?',
    type: 'multiple_choice',
    options: [
      'Vehicle accident (car, motorcycle, bicycle)',
      'Fall from height',
      'Penetrating injury (stab, gunshot)',
      'Blunt force / Assault',
      'Burns (fire, chemical, electrical)',
      'Drowning / Near-drowning',
      'Other injury',
    ],
    getNext: () => 'trauma_mobility',
  },

  trauma_mobility: {
    id: 'trauma_mobility',
    step: 3,
    text: 'Can the patient move all limbs?',
    subtext: 'Check for possible spinal injury — do not move the patient if unsure',
    type: 'yes_no',
    getNext: () => 'pain_level',
  },

  // Respiratory follow-ups
  breathing_detail: {
    id: 'breathing_detail',
    step: 3,
    text: 'Describe the breathing difficulty:',
    type: 'multiple_choice',
    options: [
      'Wheezing / Asthma-like',
      'Choking / Airway obstruction',
      'Rapid shallow breathing',
      'Lips or fingertips turning blue',
      'Cannot speak full sentences',
    ],
    getNext: () => 'pain_level',
  },

  // Neurological follow-ups
  seizure_status: {
    id: 'seizure_status',
    step: 3,
    text: 'What is the current seizure status?',
    type: 'multiple_choice',
    options: [
      'Currently seizing',
      'Seizure just ended, patient confused',
      'Multiple seizures in a row',
      'First-time seizure',
      'Known epilepsy — breakthrough seizure',
    ],
    getNext: () => 'pain_level',
  },

  // Obstetric follow-ups
  pregnancy_week: {
    id: 'pregnancy_week',
    step: 3,
    text: 'Approximately how many weeks pregnant?',
    type: 'multiple_choice',
    options: [
      'Less than 20 weeks',
      '20–32 weeks',
      '32–37 weeks',
      '37+ weeks (full term)',
      'Unknown',
    ],
    getNext: () => 'pregnancy_complication',
  },

  pregnancy_complication: {
    id: 'pregnancy_complication',
    step: 3,
    text: 'What complication is occurring?',
    type: 'multiple_choice',
    options: [
      'Active labor / Contractions',
      'Heavy vaginal bleeding',
      'Severe abdominal pain',
      'Water broke / Membrane rupture',
      'High blood pressure / Seizures',
      'Decreased fetal movement',
    ],
    getNext: () => 'pain_level',
  },

  // Other emergency
  chief_complaint: {
    id: 'chief_complaint',
    step: 3,
    text: 'Please briefly describe the medical emergency:',
    subtext: 'Include any symptoms, when they started, and what happened',
    type: 'text',
    getNext: () => 'pain_level',
  },

  // ── STEP 4: Pain Level & Special Conditions ────────────────────────────
  pain_level: {
    id: 'pain_level',
    step: 4,
    text: 'Rate the patient\'s pain level (0 = no pain, 10 = worst imaginable):',
    type: 'pain_scale',
    getNext: () => 'pregnant_check',
  },

  pregnant_check: {
    id: 'pregnant_check',
    step: 4,
    text: 'Is the patient pregnant?',
    type: 'yes_no',
    getNext: (_answer, state) => {
      // If we already came from obstetric path, skip
      if (state.answers.emergency_type?.startsWith('Pregnancy')) {
        return null; // Done — go to assessment
      }
      return null; // Done — go to assessment
    },
  },
};

// ────────────────────────────────────────────────────────────────────────────
// INFERENCE ENGINE — Rules for severity, ambulance, and hospital
// ────────────────────────────────────────────────────────────────────────────

function mapEmergencyType(answer: string): EmergencyType {
  if (!answer) return 'other';
  if (answer.startsWith('Chest pain')) return 'cardiac';
  if (answer.startsWith('Stroke')) return 'stroke';
  if (answer.startsWith('Accident')) return 'trauma';
  if (answer.startsWith('Breathing')) return 'respiratory';
  if (answer.startsWith('Seizure')) return 'neurological';
  if (answer.startsWith('Pregnancy')) return 'obstetric';
  return 'other';
}

export function inferSeverity(state: TriageState): SeverityLevel {
  const { answers } = state;

  // ── CRITICAL auto-escalation ──
  if (answers.breathing === 'No') return 'CRITICAL';
  if (answers.conscious === 'No') return 'CRITICAL';
  if (answers.bleeding === 'Yes' && answers.breathing === 'No') return 'CRITICAL';

  // Stroke within golden window
  if (answers.stroke_onset === 'Within the last hour') return 'CRITICAL';
  if (answers.stroke_symptoms === 'Multiple of the above') return 'CRITICAL';

  // Active seizure
  if (answers.seizure_status === 'Currently seizing') return 'CRITICAL';
  if (answers.seizure_status === 'Multiple seizures in a row') return 'CRITICAL';

  // Choking / blue
  if (answers.breathing_detail === 'Choking / Airway obstruction') return 'CRITICAL';
  if (answers.breathing_detail === 'Lips or fingertips turning blue') return 'CRITICAL';

  // Crushing chest pain >30min
  if (answers.chest_pain_type === 'Crushing / Squeezing pressure' &&
      answers.chest_pain_duration === 'More than 30 minutes') return 'CRITICAL';

  // Penetrating injury
  if (answers.trauma_type === 'Penetrating injury (stab, gunshot)') return 'CRITICAL';

  // Pregnancy emergencies
  if (answers.pregnancy_complication === 'Heavy vaginal bleeding') return 'CRITICAL';
  if (answers.pregnancy_complication === 'High blood pressure / Seizures') return 'CRITICAL';

  // ── HIGH ──
  if (answers.bleeding === 'Yes') return 'HIGH';
  if (answers.chest_pain_type === 'Crushing / Squeezing pressure') return 'HIGH';
  if (answers.chest_pain_type === 'Radiating to arm, jaw, or back') return 'HIGH';
  if (answers.chest_pain_type === 'Tightness with shortness of breath') return 'HIGH';
  if (answers.stroke_onset === '1–3 hours ago') return 'HIGH';
  if (answers.trauma_type === 'Vehicle accident (car, motorcycle, bicycle)') return 'HIGH';
  if (answers.trauma_type === 'Fall from height') return 'HIGH';
  if (answers.trauma_type === 'Burns (fire, chemical, electrical)') return 'HIGH';
  if (answers.trauma_type === 'Drowning / Near-drowning') return 'HIGH';
  if (answers.trauma_mobility === 'No') return 'HIGH';
  if (answers.breathing_detail === 'Rapid shallow breathing') return 'HIGH';
  if (answers.breathing_detail === 'Cannot speak full sentences') return 'HIGH';
  if (answers.seizure_status === 'Seizure just ended, patient confused') return 'HIGH';
  if (answers.seizure_status === 'First-time seizure') return 'HIGH';
  if (answers.pregnancy_complication === 'Active labor / Contractions') return 'HIGH';
  if (answers.pregnancy_complication === 'Severe abdominal pain') return 'HIGH';
  if (answers.pregnancy_complication === 'Water broke / Membrane rupture') return 'HIGH';

  // Pain level escalation
  const painLevel = parseInt(answers.pain_level) || 0;
  if (painLevel >= 9) return 'HIGH';

  // ── MODERATE ──
  if (painLevel >= 5) return 'MODERATE';
  if (answers.chest_pain_type === 'Sharp / Stabbing pain') return 'MODERATE';
  if (answers.chest_pain_type === 'Burning sensation') return 'MODERATE';
  if (answers.breathing_detail === 'Wheezing / Asthma-like') return 'MODERATE';
  if (answers.pregnancy_complication === 'Decreased fetal movement') return 'MODERATE';

  // ── LOW ──
  return 'LOW';
}

function inferEquipment(state: TriageState): string[] {
  const { answers } = state;
  const equipment: string[] = ['First aid kit', 'Stretcher'];

  if (answers.breathing === 'No') {
    equipment.push('Oxygen supply', 'Ventilator / BVM', 'Pulse oximeter');
  }

  if (answers.conscious === 'No') {
    equipment.push('Neuro monitoring', 'Cervical collar', 'IV access kit');
  }

  if (answers.bleeding === 'Yes') {
    equipment.push('Tourniquet', 'Hemostatic gauze', 'IV fluids', 'Blood pressure monitor');
  }

  const emergencyType = mapEmergencyType(answers.emergency_type);

  if (emergencyType === 'cardiac') {
    equipment.push('12-lead ECG', 'Defibrillator (AED)', 'Cardiac medications', 'Aspirin');
  }

  if (emergencyType === 'stroke') {
    equipment.push('Blood glucose monitor', 'Neuro assessment tools', 'IV access kit');
  }

  if (emergencyType === 'trauma') {
    equipment.push('Trauma kit', 'Spinal board', 'Splints', 'Cervical collar');
    if (answers.trauma_type?.includes('Burns')) {
      equipment.push('Burn dressings', 'Cooling packs', 'Pain medications');
    }
  }

  if (emergencyType === 'respiratory') {
    equipment.push('Oxygen supply', 'Nebulizer', 'Pulse oximeter', 'Suction unit');
  }

  if (emergencyType === 'neurological') {
    equipment.push('Anti-seizure medications', 'Oxygen supply', 'Padded restraints');
  }

  if (emergencyType === 'obstetric') {
    equipment.push('OB kit (delivery pack)', 'Fetal monitor', 'IV access kit', 'Oxytocin');
  }

  // Deduplicate
  return [...new Set(equipment)];
}

function inferStaff(state: TriageState): string[] {
  const severity = inferSeverity(state);
  const emergencyType = mapEmergencyType(state.answers.emergency_type);
  const staff: string[] = ['EMT'];

  if (severity === 'CRITICAL' || severity === 'HIGH') {
    staff.push('Paramedic');
  }

  if (severity === 'CRITICAL') {
    staff.push('Critical Care Specialist');
  }

  if (emergencyType === 'cardiac') {
    staff.push('Cardiac-trained Paramedic');
  }

  if (emergencyType === 'obstetric') {
    staff.push('OB-trained Paramedic');
  }

  if (emergencyType === 'neurological') {
    staff.push('Advanced Life Support Technician');
  }

  return [...new Set(staff)];
}

function inferAmbulanceType(state: TriageState): 'BLS' | 'ALS' | 'ICU' | 'NEONATAL' {
  const severity = inferSeverity(state);
  const emergencyType = mapEmergencyType(state.answers.emergency_type);

  if (state.answers.breathing === 'No' || state.answers.conscious === 'No') return 'ICU';
  if (emergencyType === 'obstetric' && state.answers.pregnancy_week === 'Less than 20 weeks') return 'ALS';
  if (emergencyType === 'obstetric') return 'NEONATAL';
  if (severity === 'CRITICAL') return 'ICU';
  if (severity === 'HIGH') return 'ALS';
  if (severity === 'MODERATE') return 'ALS';
  return 'BLS';
}

function inferHospital(state: TriageState): HospitalRecommendation {
  const severity = inferSeverity(state);
  const emergencyType = mapEmergencyType(state.answers.emergency_type);
  const units: string[] = ['Emergency Department'];
  let type = 'General Hospital';
  let reason = '';

  switch (emergencyType) {
    case 'cardiac':
      type = 'Cardiac Center / Level 1 Trauma Center';
      units.push('Cardiac Catheterization Lab', 'ICU');
      reason = 'Cardiac emergency requires immediate access to catheterization lab and cardiac ICU';
      break;
    case 'stroke':
      type = 'Comprehensive Stroke Center';
      units.push('Neurology Unit', 'CT/MRI Imaging', 'Neuro ICU');
      reason = 'Stroke requires immediate neuroimaging and potential thrombolysis';
      break;
    case 'trauma':
      type = 'Level 1 Trauma Center';
      units.push('Trauma Surgery', 'Orthopedics', 'ICU');
      if (state.answers.trauma_type?.includes('Burns')) {
        type = 'Burn Center / Level 1 Trauma Center';
        units.push('Burn Unit');
        reason = 'Burn injuries require specialized burn treatment facility';
      } else {
        reason = 'Trauma requires immediate surgical capability and trauma team activation';
      }
      break;
    case 'respiratory':
      type = 'Hospital with Pulmonology Unit';
      units.push('Respiratory ICU', 'Pulmonology');
      reason = 'Respiratory emergency requires ventilator capability and pulmonology support';
      break;
    case 'neurological':
      type = 'Hospital with Neurology Unit';
      units.push('Neurology Unit', 'CT/MRI Imaging');
      reason = 'Neurological emergency requires neuro diagnostics and monitoring';
      break;
    case 'obstetric':
      type = 'Hospital with Maternity / NICU';
      units.push('Labor & Delivery', 'NICU', 'OB Surgery');
      reason = 'Obstetric emergency requires L&D unit and neonatal intensive care availability';
      break;
    default:
      if (severity === 'CRITICAL' || severity === 'HIGH') {
        type = 'Level 1 or Level 2 Trauma Center';
        units.push('ICU');
        reason = 'High-severity emergency requires advanced emergency care capability';
      } else {
        type = 'General Hospital or Urgent Care';
        reason = 'Moderate/low severity — general emergency department is sufficient';
      }
  }

  return { type, requiredUnits: [...new Set(units)], reason };
}

function buildReasoning(state: TriageState): string[] {
  const { answers } = state;
  const reasons: string[] = [];

  if (answers.breathing === 'No') {
    reasons.push('⚠️ Patient is NOT breathing — immediate airway intervention required');
  }
  if (answers.conscious === 'No') {
    reasons.push('⚠️ Patient is UNCONSCIOUS — neurological monitoring and ICU support needed');
  }
  if (answers.bleeding === 'Yes') {
    reasons.push('⚠️ Severe bleeding detected — hemorrhage control and IV fluids required');
  }

  const eType = mapEmergencyType(answers.emergency_type);
  if (eType === 'cardiac') {
    reasons.push(`Cardiac event detected: ${answers.chest_pain_type || 'chest pain reported'}`);
    if (answers.chest_pain_duration) reasons.push(`Duration: ${answers.chest_pain_duration}`);
  }
  if (eType === 'stroke') {
    reasons.push(`Stroke symptoms identified — onset: ${answers.stroke_onset || 'unknown'}`);
    if (answers.stroke_symptoms) reasons.push(`Symptoms: ${answers.stroke_symptoms}`);
  }
  if (eType === 'trauma') {
    reasons.push(`Trauma: ${answers.trauma_type || 'injury reported'}`);
    if (answers.trauma_mobility === 'No') {
      reasons.push('⚠️ Patient cannot move limbs — possible spinal injury, do NOT move');
    }
  }
  if (eType === 'respiratory') {
    reasons.push(`Respiratory distress: ${answers.breathing_detail || 'breathing difficulty'}`);
  }
  if (eType === 'neurological') {
    reasons.push(`Neurological event: ${answers.seizure_status || 'seizure/neuro issue'}`);
  }
  if (eType === 'obstetric') {
    reasons.push(`Obstetric emergency — ${answers.pregnancy_week || 'unknown'} weeks`);
    if (answers.pregnancy_complication) reasons.push(`Complication: ${answers.pregnancy_complication}`);
  }

  if (answers.pain_level) {
    const p = parseInt(answers.pain_level);
    if (p >= 8) reasons.push(`Severe pain reported: ${p}/10`);
    else if (p >= 5) reasons.push(`Moderate pain: ${p}/10`);
    else reasons.push(`Pain level: ${p}/10`);
  }

  if (answers.pregnant_check === 'Yes' && eType !== 'obstetric') {
    reasons.push('Patient is pregnant — obstetric precautions apply');
  }

  return reasons;
}

// ────────────────────────────────────────────────────────────────────────────
// PUBLIC API — Consumed by TriageChat component
// ────────────────────────────────────────────────────────────────────────────

export function getFirstQuestionId(): string {
  return 'breathing';
}

export function getQuestion(id: string): TriageQuestion | null {
  return QUESTIONS[id] || null;
}

export function getNextQuestionId(currentId: string, answer: string, state: TriageState): string | null {
  const question = QUESTIONS[currentId];
  if (!question) return null;
  return question.getNext(answer, state);
}

/** Build a partial TriageState from collected answers so far */
export function buildState(answers: Record<string, string>): TriageState {
  const state: TriageState = {
    answers,
    severity: 'LOW',
    emergencyType: mapEmergencyType(answers.emergency_type),
    equipment: [],
    staff: [],
    reasoning: [],
    hospitalUnits: [],
  };

  state.severity = inferSeverity(state);
  state.equipment = inferEquipment(state);
  state.staff = inferStaff(state);
  state.reasoning = buildReasoning(state);

  const hospital = inferHospital(state);
  state.hospitalUnits = hospital.requiredUnits;

  return state;
}

/** Generate the final triage result after all questions are answered */
export function generateTriageResult(answers: Record<string, string>): TriageResult {
  const state = buildState(answers);
  const severity = inferSeverity(state);
  const emergencyType = mapEmergencyType(answers.emergency_type);
  const equipment = inferEquipment(state);
  const staff = inferStaff(state);
  const ambulanceType = inferAmbulanceType(state);
  const hospital = inferHospital(state);
  const reasoning = buildReasoning(state);

  // Build chief complaint from answers
  let chiefComplaint = '';
  if (answers.chief_complaint) {
    chiefComplaint = answers.chief_complaint;
  } else {
    const parts: string[] = [];
    if (answers.emergency_type) parts.push(answers.emergency_type);
    if (answers.chest_pain_type) parts.push(answers.chest_pain_type);
    if (answers.trauma_type) parts.push(answers.trauma_type);
    if (answers.breathing_detail) parts.push(answers.breathing_detail);
    if (answers.seizure_status) parts.push(answers.seizure_status);
    if (answers.pregnancy_complication) parts.push(answers.pregnancy_complication);
    chiefComplaint = parts.join(' — ') || 'Emergency';
  }

  return {
    severity,
    emergencyType,
    ambulance: {
      type: ambulanceType,
      equipment,
      staff,
    },
    hospital,
    reasoning,
    chiefComplaint,
    isBreathing: answers.breathing !== 'No',
    isConscious: answers.conscious !== 'No',
    hasChestPain: emergencyType === 'cardiac',
    hasSevereBleeding: answers.bleeding === 'Yes',
    painLevel: parseInt(answers.pain_level) || 0,
    isPregnant: answers.pregnant_check === 'Yes' || emergencyType === 'obstetric',
    answers,
  };
}

export function getSeverityColor(severity: SeverityLevel): string {
  switch (severity) {
    case 'CRITICAL': return '#dc2626';
    case 'HIGH': return '#ea580c';
    case 'MODERATE': return '#ca8a04';
    case 'LOW': return '#16a34a';
  }
}

export function getSeverityEmoji(severity: SeverityLevel): string {
  switch (severity) {
    case 'CRITICAL': return '🔴';
    case 'HIGH': return '🟠';
    case 'MODERATE': return '🟡';
    case 'LOW': return '🟢';
  }
}

export function getAmbulanceTypeLabel(type: 'BLS' | 'ALS' | 'ICU' | 'NEONATAL'): string {
  switch (type) {
    case 'BLS': return 'Basic Life Support';
    case 'ALS': return 'Advanced Life Support';
    case 'ICU': return 'Mobile ICU';
    case 'NEONATAL': return 'Neonatal / Obstetric Unit';
  }
}
