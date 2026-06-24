// ============================================================================
// NLP Triage — Free-text Symptom Extraction Engine
// ============================================================================
// A self-contained, rule-based natural-language processor that turns a
// free-form emergency description (e.g. "I'm having crushing chest pain for
// the last 30 minutes and I've been vomiting") into the structured `answers`
// map consumed by triageEngine.ts — plus a list of extracted keywords used
// for hospital matching.
//
// Deterministic. No external AI APIs. Mirrors the design philosophy of
// triageEngine.ts (pure functions, easily testable).
// ============================================================================

import type { EmergencyType } from './triageEngine';

// ── Public types ──────────────────────────────────────────────────────────────

/** A single piece of evidence pulled out of the user's text. */
export interface ExtractedKeyword {
  /** Canonical, human-readable label shown as a chip. */
  label: string;
  /** The category this keyword contributed to. */
  category:
    | 'emergency'
    | 'symptom'
    | 'vital'
    | 'duration'
    | 'pain'
    | 'bodypart'
    | 'redflag';
}

export interface NlpExtraction {
  /** Best-guess emergency category. */
  emergencyType: EmergencyType;
  /** Canonical keywords/entities detected (deduped). */
  keywords: ExtractedKeyword[];
  /** Plain symptom keyword strings, for backend hospital matching. */
  matchTerms: string[];
  /** The original text. */
  rawText: string;
  /** null = not mentioned (caller should ask). */
  breathing: boolean | null;
  conscious: boolean | null;
  bleeding: boolean | null;
  painLevel: number | null;
  durationMinutes: number | null;
  durationLabel: string | null;
  /** Partial answers map compatible with triageEngine.ts question ids. */
  answers: Record<string, string>;
  /** Human-readable red-flag warnings. */
  redFlags: string[];
  /** 0..1 — how confident the extractor is that it understood the text. */
  confidence: number;
}

/** A follow-up the chat should ask because the text didn't cover it. */
export interface Clarifier {
  /** triageEngine answer key this fills. */
  key: string;
  text: string;
  subtext?: string;
  type: 'yes_no' | 'multiple_choice' | 'pain_scale';
  options?: string[];
}

// ── Engine option-string constants (must match triageEngine.ts EXACTLY) ───────

const ET = {
  cardiac: 'Chest pain / Heart problem',
  stroke: 'Stroke symptoms (face drooping, arm weakness, speech difficulty)',
  trauma: 'Accident / Injury / Trauma',
  respiratory: 'Breathing difficulty / Respiratory distress',
  neuro: 'Seizure / Neurological issue',
  obstetric: 'Pregnancy / Childbirth complication',
  other: 'Other medical emergency',
} as const;

// ── Tokenisation helpers ──────────────────────────────────────────────────────

const NEGATION_TOKENS = [
  'no', 'not', "n't", 'cannot', "can't", 'cant', 'without', 'never',
  'unable', 'isnt', "isn't", 'arent', "aren't", 'wasnt', "wasn't",
  'stopped', 'stop', 'lost', 'loss', 'none', 'denies',
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'") // smart quotes → '
    .replace(/[^a-z0-9'\/\.\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Is `phrase` negated in `text`? Looks for a negation token within a small
 * window of words BEFORE the phrase. e.g. "is not breathing", "can't breathe".
 */
function isNegated(text: string, phrase: string): boolean {
  const idx = text.indexOf(phrase);
  if (idx === -1) return false;
  const before = text.slice(Math.max(0, idx - 28), idx);
  const words = before.split(/\s+/).filter(Boolean).slice(-4);
  return words.some((w) => NEGATION_TOKENS.includes(w));
}

function includesAny(text: string, phrases: string[]): string | null {
  for (const p of phrases) {
    if (text.includes(p)) return p;
  }
  return null;
}

// ── Symptom lexicon ───────────────────────────────────────────────────────────
// Each entry maps trigger phrases → a canonical label + (optionally) the
// emergency type it implies. Weight nudges category selection.

interface LexEntry {
  label: string;
  phrases: string[];
  type?: EmergencyType;
  weight?: number; // default 1
}

const SYMPTOM_LEXICON: LexEntry[] = [
  // ── Cardiac ──
  { label: 'Chest pain', type: 'cardiac', weight: 3, phrases: ['chest pain', 'pain in my chest', 'pain in chest', 'pain in the chest', 'chest hurts', 'chest tightness', 'tight chest', 'chest pressure', 'pressure in chest', 'heart pain', 'chest discomfort'] },
  { label: 'Heart attack concern', type: 'cardiac', weight: 4, phrases: ['heart attack', 'cardiac arrest', 'heart stopped', 'myocardial'] },
  { label: 'Palpitations', type: 'cardiac', weight: 1, phrases: ['palpitation', 'racing heart', 'heart racing', 'irregular heartbeat', 'heart pounding', 'fluttering'] },
  { label: 'Pain radiating to arm/jaw', type: 'cardiac', weight: 2, phrases: ['pain in my arm', 'arm pain', 'left arm', 'pain in jaw', 'jaw pain', 'radiating', 'pain spreading'] },

  // ── Stroke ──
  { label: 'Face drooping', type: 'stroke', weight: 3, phrases: ['face drooping', 'face is drooping', 'droopy face', 'face droop', 'one side of face', 'facial droop'] },
  { label: 'Arm weakness', type: 'stroke', weight: 2, phrases: ['arm weakness', 'weak arm', "can't lift arm", 'cant lift arm', 'arm is numb', 'one side weak', 'weakness on one side'] },
  { label: 'Slurred speech', type: 'stroke', weight: 3, phrases: ['slurred speech', 'slurring', 'speech difficulty', 'trouble speaking', 'words are jumbled', 'confused speech', 'cant get words out'] },
  { label: 'Stroke symptoms', type: 'stroke', weight: 4, phrases: ['stroke', 'having a stroke'] },
  { label: 'Sudden severe headache', type: 'stroke', weight: 2, phrases: ['worst headache', 'severe headache', 'thunderclap headache', 'sudden headache'] },
  { label: 'Vision problems', type: 'stroke', weight: 1, phrases: ['vision problem', "can't see", 'cant see', 'blurred vision', 'double vision', 'loss of vision', 'blind'] },
  { label: 'Numbness', type: 'stroke', weight: 1, phrases: ['numbness', 'numb', 'tingling', "can't feel"] },

  // ── Respiratory ──
  { label: 'Shortness of breath', type: 'respiratory', weight: 3, phrases: ['shortness of breath', 'short of breath', 'cant breathe', "can't breathe", 'cannot breathe', 'difficulty breathing', 'trouble breathing', 'hard to breathe', 'struggling to breathe', 'breathless', 'out of breath', 'gasping'] },
  { label: 'Wheezing / Asthma', type: 'respiratory', weight: 2, phrases: ['wheezing', 'wheeze', 'asthma', 'asthma attack', 'inhaler'] },
  { label: 'Choking', type: 'respiratory', weight: 4, phrases: ['choking', 'choke', 'something stuck in throat', 'airway blocked', 'cant swallow'] },
  { label: 'Blue lips / cyanosis', type: 'respiratory', weight: 4, phrases: ['blue lips', 'lips turning blue', 'turning blue', 'blue fingertips', 'cyanosis', 'going blue'] },

  // ── Trauma ──
  { label: 'Vehicle accident', type: 'trauma', weight: 3, phrases: ['car accident', 'car crash', 'road accident', 'motorcycle accident', 'bike accident', 'hit by a car', 'vehicle accident', 'collision', 'crashed'] },
  { label: 'Fall', type: 'trauma', weight: 2, phrases: ['fell down', 'fell from', 'fall from height', 'fell off', 'had a fall', 'slipped and fell'] },
  { label: 'Penetrating injury', type: 'trauma', weight: 4, phrases: ['stabbed', 'stab wound', 'gunshot', 'shot', 'knife wound', 'impaled'] },
  { label: 'Assault / blunt force', type: 'trauma', weight: 2, phrases: ['assault', 'beaten', 'hit on the head', 'punched', 'attacked'] },
  { label: 'Burns', type: 'trauma', weight: 3, phrases: ['burn', 'burned', 'burnt', 'scalded', 'on fire', 'electrocuted', 'electric shock', 'chemical burn'] },
  { label: 'Drowning', type: 'trauma', weight: 3, phrases: ['drowning', 'drowned', 'near drowning', 'pulled from water'] },
  { label: 'Fracture / broken bone', type: 'trauma', weight: 2, phrases: ['broken bone', 'broken leg', 'broken arm', 'fracture', 'bone sticking out', 'dislocated'] },
  { label: 'Head injury', type: 'trauma', weight: 2, phrases: ['head injury', 'hit my head', 'head wound', 'cracked skull', 'concussion'] },

  // ── Neurological ──
  { label: 'Seizure', type: 'neurological', weight: 4, phrases: ['seizure', 'seizing', 'convulsion', 'convulsing', 'fits', 'having a fit', 'epileptic', 'epilepsy', 'shaking uncontrollably'] },
  // Fainting/collapse is intentionally type-less: it should not steer toward a
  // seizure follow-up. The consciousness red-flag scan below handles severity.
  { label: 'Fainting / collapse', weight: 1, phrases: ['fainted', 'collapsed', 'passed out', 'blacked out', 'lost consciousness'] },
  { label: 'Confusion', type: 'neurological', weight: 1, phrases: ['confused', 'disoriented', 'not making sense', 'altered mental'] },

  // ── Obstetric ──
  { label: 'Pregnancy / labor', type: 'obstetric', weight: 4, phrases: ['pregnant', 'pregnancy', 'in labor', 'in labour', 'contractions', 'water broke', 'going into labor', 'giving birth', 'childbirth'] },
  { label: 'Vaginal bleeding', type: 'obstetric', weight: 3, phrases: ['vaginal bleeding', 'bleeding down there'] },

  // ── Generic / associated symptoms (no strong type, used as context) ──
  { label: 'Vomiting', weight: 1, phrases: ['vomiting', 'vomited', 'throwing up', 'threw up', 'puking', 'nausea', 'nauseous', 'feeling sick'] },
  { label: 'Sweating', weight: 1, phrases: ['sweating', 'cold sweat', 'clammy', 'profuse sweat'] },
  { label: 'Dizziness', weight: 1, phrases: ['dizzy', 'dizziness', 'lightheaded', 'light headed', 'vertigo', 'spinning'] },
  { label: 'Fever', weight: 1, phrases: ['fever', 'high temperature', 'burning up', 'chills'] },
  { label: 'Severe allergic reaction', type: 'respiratory', weight: 3, phrases: ['allergic reaction', 'anaphylaxis', 'throat swelling', 'swollen throat', 'hives', 'epipen'] },
  { label: 'Abdominal pain', weight: 1, phrases: ['stomach pain', 'abdominal pain', 'belly pain', 'pain in stomach', 'cramps'] },
  { label: 'Overdose / poisoning', type: 'other', weight: 3, phrases: ['overdose', 'poisoning', 'poisoned', 'swallowed pills', 'drug overdose', 'took too many'] },
  { label: 'Diabetic emergency', type: 'other', weight: 2, phrases: ['diabetic', 'low blood sugar', 'high blood sugar', 'hypoglycemia', 'insulin'] },
];

// Body parts (context only — surfaced as chips, help hospital matching).
const BODY_PARTS: { label: string; phrases: string[] }[] = [
  { label: 'Chest', phrases: ['chest'] },
  { label: 'Head', phrases: ['head', 'skull'] },
  { label: 'Abdomen', phrases: ['stomach', 'abdomen', 'belly'] },
  { label: 'Back', phrases: ['back', 'spine'] },
  { label: 'Arm', phrases: ['arm'] },
  { label: 'Leg', phrases: ['leg'] },
  { label: 'Neck', phrases: ['neck'] },
];

// ── Pain extraction ───────────────────────────────────────────────────────────

function extractPain(text: string): number | null {
  // explicit "8/10" or "8 out of 10"
  const m = text.match(/(\d{1,2})\s*(?:\/|out of)\s*10/);
  if (m) return Math.min(10, Math.max(0, parseInt(m[1], 10)));

  if (includesAny(text, ['no pain', 'painless', 'no discomfort'])) return 0;
  if (includesAny(text, ['excruciating', 'unbearable', 'worst pain', 'agonizing', 'agony', '10 out of 10'])) return 10;
  if (includesAny(text, ['severe pain', 'severe', 'intense pain', 'extreme pain', 'really bad pain', 'terrible pain'])) return 9;
  if (includesAny(text, ['very painful', 'a lot of pain', 'lots of pain', 'really painful'])) return 8;
  if (includesAny(text, ['bad pain', 'strong pain', 'sharp pain', 'painful'])) return 7;
  if (includesAny(text, ['moderate pain', 'some pain', 'aching', 'sore'])) return 5;
  if (includesAny(text, ['mild pain', 'slight pain', 'little pain', 'minor', 'mild'])) return 3;
  return null;
}

// ── Duration extraction ───────────────────────────────────────────────────────

function extractDuration(text: string): { minutes: number | null; label: string | null; wokeUp: boolean; comesAndGoes: boolean } {
  const wokeUp = /woke up|woken up|since (?:i|he|she|they) woke/.test(text);
  const comesAndGoes = /comes and goes|on and off|on-and-off|intermittent|comes back/.test(text);

  let minutes: number | null = null;

  // "30 minutes", "2 hours", "3 hrs", "an hour", "half an hour", "90 mins"
  const num = text.match(/(\d+(?:\.\d+)?)\s*(min|mins|minute|minutes|hour|hours|hr|hrs|day|days)/);
  if (num) {
    const v = parseFloat(num[1]);
    const unit = num[2];
    if (/^min/.test(unit)) minutes = v;
    else if (/^h/.test(unit)) minutes = v * 60;
    else if (/^day/.test(unit)) minutes = v * 60 * 24;
  } else if (/half an hour|half hour/.test(text)) {
    minutes = 30;
  } else if (/\ban hour\b|\bone hour\b|\ba hour\b/.test(text)) {
    minutes = 60;
  } else if (/few minutes|couple of minutes|just (?:started|now|began)|moments ago/.test(text)) {
    minutes = 2;
  } else if (/since (?:this )?morning|all day|since last night|since yesterday|all night/.test(text)) {
    minutes = 8 * 60;
  }

  let label: string | null = null;
  if (minutes != null) {
    if (minutes < 60) label = `~${Math.round(minutes)} min`;
    else if (minutes < 60 * 24) label = `~${(minutes / 60).toFixed(minutes % 60 === 0 ? 0 : 1)} hr`;
    else label = `~${Math.round(minutes / (60 * 24))} day(s)`;
  }
  return { minutes, label, wokeUp, comesAndGoes };
}

// ── Main analyzer ─────────────────────────────────────────────────────────────

export function analyzeText(rawText: string): NlpExtraction {
  const text = normalize(rawText);
  const answers: Record<string, string> = { chief_complaint: rawText.trim() };
  const keywords: ExtractedKeyword[] = [];
  const matchTerms: string[] = [];
  const redFlags: string[] = [];
  const typeScores: Record<EmergencyType, number> = {
    cardiac: 0, stroke: 0, trauma: 0, respiratory: 0, neurological: 0, obstetric: 0, other: 0,
  };

  const pushKeyword = (label: string, category: ExtractedKeyword['category']) => {
    if (!keywords.some((k) => k.label === label)) {
      keywords.push({ label, category });
      if (category === 'symptom' || category === 'emergency') matchTerms.push(label.toLowerCase());
    }
  };

  // ── 1. Symptom lexicon scan ──
  for (const entry of SYMPTOM_LEXICON) {
    const hit = includesAny(text, entry.phrases);
    if (!hit) continue;
    pushKeyword(entry.label, entry.type ? 'emergency' : 'symptom');
    if (entry.type) typeScores[entry.type] += entry.weight ?? 1;
  }

  // ── 2. Body parts ──
  const bodyParts: string[] = [];
  for (const bp of BODY_PARTS) {
    if (includesAny(text, bp.phrases)) {
      bodyParts.push(bp.label);
      pushKeyword(bp.label, 'bodypart');
    }
  }

  // ── 3. Vitals / red flags (with negation handling) ──
  let breathing: boolean | null = null;
  let conscious: boolean | null = null;
  let bleeding: boolean | null = null;

  // Breathing
  const notBreathingPhrases = ['not breathing', 'stopped breathing', 'no breathing', 'no pulse', 'not responding and not breathing'];
  if (includesAny(text, notBreathingPhrases) ||
      (includesAny(text, ['breathing']) && isNegated(text, 'breathing'))) {
    breathing = false;
    redFlags.push('Patient is NOT breathing');
    pushKeyword('Not breathing', 'redflag');
  } else if (includesAny(text, ['breathing normally', 'is breathing', 'breathing fine', 'breathing ok'])) {
    breathing = true;
  }

  // Consciousness
  const unconsciousPhrases = ['unconscious', 'unresponsive', 'not responding', 'wont wake up', "won't wake up", 'passed out', 'fainted', 'blacked out', 'lost consciousness', 'not waking up', 'collapsed and'];
  if (includesAny(text, unconsciousPhrases)) {
    conscious = false;
    redFlags.push('Patient is UNCONSCIOUS / unresponsive');
    pushKeyword('Unconscious', 'redflag');
  } else if (includesAny(text, ['conscious', 'awake', 'responsive', 'alert and'])) {
    if (!isNegated(text, 'conscious')) conscious = true;
    else { conscious = false; pushKeyword('Unconscious', 'redflag'); }
  }

  // Bleeding
  const bleedingPhrases = ['severe bleeding', 'heavy bleeding', 'bleeding badly', 'bleeding a lot', 'lots of blood', 'gushing blood', 'cant stop the bleeding', "can't stop the bleeding", 'uncontrolled bleeding', 'hemorrhage', 'bleeding heavily', 'blood everywhere'];
  if (includesAny(text, bleedingPhrases)) {
    bleeding = true;
    redFlags.push('Severe / uncontrolled bleeding');
    pushKeyword('Severe bleeding', 'redflag');
  } else if (includesAny(text, ['bleeding', 'blood']) && !isNegated(text, 'bleeding')) {
    // mild/unspecified bleeding mentioned — flag but leave severity to clarifier
    pushKeyword('Bleeding', 'symptom');
    matchTerms.push('bleeding');
  } else if (includesAny(text, ['no bleeding', 'not bleeding'])) {
    bleeding = false;
  }

  // Critical respiratory/neuro red flags already scored above; surface as flags
  if (includesAny(text, ['choking', 'airway blocked'])) redFlags.push('Possible airway obstruction (choking)');
  if (includesAny(text, ['blue lips', 'turning blue', 'cyanosis'])) redFlags.push('Cyanosis (blue lips/fingertips) — low oxygen');

  // ── 4. Pain & duration ──
  const painLevel = extractPain(text);
  if (painLevel != null) {
    answers.pain_level = String(painLevel);
    pushKeyword(`Pain ${painLevel}/10`, 'pain');
  }

  const dur = extractDuration(text);
  if (dur.label) pushKeyword(`Duration ${dur.label}`, 'duration');
  else if (dur.wokeUp) pushKeyword('Onset: woke up with it', 'duration');
  else if (dur.comesAndGoes) pushKeyword('Comes and goes', 'duration');

  // ── 5. Choose emergency type ──
  let emergencyType: EmergencyType = 'other';
  let best = 0;
  for (const t of Object.keys(typeScores) as EmergencyType[]) {
    if (typeScores[t] > best) { best = typeScores[t]; emergencyType = t; }
  }

  if (best > 0) {
    answers.emergency_type =
      emergencyType === 'cardiac' ? ET.cardiac
      : emergencyType === 'stroke' ? ET.stroke
      : emergencyType === 'trauma' ? ET.trauma
      : emergencyType === 'respiratory' ? ET.respiratory
      : emergencyType === 'neurological' ? ET.neuro
      : emergencyType === 'obstetric' ? ET.obstetric
      : ET.other;
  }

  // ── 6. Map detail answers for the chosen type ──
  mapTypeDetails(text, emergencyType, answers, dur);

  // ── 7. Persist vitals into answers ──
  if (breathing === false) answers.breathing = 'No';
  else if (breathing === true) answers.breathing = 'Yes';
  if (conscious === false) answers.conscious = 'No';
  else if (conscious === true) answers.conscious = 'Yes';
  if (bleeding === false) answers.bleeding = 'No';
  else if (bleeding === true) answers.bleeding = 'Yes';

  // ── 8. Confidence ──
  const signals = keywords.length + (painLevel != null ? 1 : 0) + (dur.minutes != null ? 1 : 0) + redFlags.length;
  const confidence = Math.max(0, Math.min(1, signals / 4));

  return {
    emergencyType,
    keywords,
    matchTerms: [...new Set(matchTerms)],
    rawText: rawText.trim(),
    breathing,
    conscious,
    bleeding,
    painLevel,
    durationMinutes: dur.minutes,
    durationLabel: dur.label,
    answers,
    redFlags,
    confidence,
  };
}

// ── Detail-answer mapping per emergency type ──────────────────────────────────

function mapTypeDetails(
  text: string,
  type: EmergencyType,
  answers: Record<string, string>,
  dur: { minutes: number | null; wokeUp: boolean; comesAndGoes: boolean },
) {
  if (type === 'cardiac') {
    if (includesAny(text, ['crushing', 'squeezing', 'pressure', 'heavy', 'elephant on'])) {
      answers.chest_pain_type = 'Crushing / Squeezing pressure';
    } else if (includesAny(text, ['radiating', 'arm', 'jaw', 'spreading to', 'into my back'])) {
      answers.chest_pain_type = 'Radiating to arm, jaw, or back';
    } else if (includesAny(text, ['tight', 'shortness of breath', 'short of breath', 'cant breathe', "can't breathe"])) {
      answers.chest_pain_type = 'Tightness with shortness of breath';
    } else if (includesAny(text, ['burning'])) {
      answers.chest_pain_type = 'Burning sensation';
    } else if (includesAny(text, ['sharp', 'stabbing'])) {
      answers.chest_pain_type = 'Sharp / Stabbing pain';
    }
    if (dur.comesAndGoes) {
      answers.chest_pain_duration = 'Comes and goes over hours';
    } else if (dur.minutes != null) {
      answers.chest_pain_duration =
        dur.minutes < 5 ? 'Just started (less than 5 minutes)'
        : dur.minutes <= 30 ? '5–30 minutes'
        : 'More than 30 minutes';
    }
  }

  if (type === 'stroke') {
    if (dur.wokeUp) answers.stroke_onset = 'Unknown / Woke up with symptoms';
    else if (dur.minutes != null) {
      answers.stroke_onset =
        dur.minutes <= 60 ? 'Within the last hour'
        : dur.minutes <= 180 ? '1–3 hours ago'
        : dur.minutes <= 360 ? '3–6 hours ago'
        : 'More than 6 hours ago';
    }
    const sx: string[] = [];
    if (includesAny(text, ['face drooping', 'droopy face', 'face droop', 'facial droop'])) sx.push('face');
    if (includesAny(text, ['arm weakness', 'weak arm', 'cant lift', "can't lift"])) sx.push('arm');
    if (includesAny(text, ['slurred', 'speech', 'cant speak', "can't speak"])) sx.push('speech');
    if (includesAny(text, ['headache'])) sx.push('headache');
    if (includesAny(text, ['vision', 'blurred', 'cant see', "can't see"])) sx.push('vision');
    if (sx.length >= 2) answers.stroke_symptoms = 'Multiple of the above';
    else if (sx[0] === 'face') answers.stroke_symptoms = 'Face drooping on one side';
    else if (sx[0] === 'arm') answers.stroke_symptoms = 'Arm weakness / Cannot lift both arms';
    else if (sx[0] === 'speech') answers.stroke_symptoms = 'Speech difficulty / Slurred speech';
    else if (sx[0] === 'headache') answers.stroke_symptoms = 'Sudden severe headache';
    else if (sx[0] === 'vision') answers.stroke_symptoms = 'Vision problems';
  }

  if (type === 'trauma') {
    if (includesAny(text, ['car', 'motorcycle', 'bike', 'vehicle', 'crash', 'collision', 'road accident'])) {
      answers.trauma_type = 'Vehicle accident (car, motorcycle, bicycle)';
    } else if (includesAny(text, ['fell', 'fall', 'slipped'])) {
      answers.trauma_type = 'Fall from height';
    } else if (includesAny(text, ['stab', 'gunshot', 'shot', 'knife', 'impaled'])) {
      answers.trauma_type = 'Penetrating injury (stab, gunshot)';
    } else if (includesAny(text, ['burn', 'scalded', 'on fire', 'electrocuted', 'chemical'])) {
      answers.trauma_type = 'Burns (fire, chemical, electrical)';
    } else if (includesAny(text, ['drowning', 'drowned', 'water'])) {
      answers.trauma_type = 'Drowning / Near-drowning';
    } else if (includesAny(text, ['assault', 'beaten', 'punched', 'attacked', 'hit on the head'])) {
      answers.trauma_type = 'Blunt force / Assault';
    } else {
      answers.trauma_type = 'Other injury';
    }
    if (includesAny(text, ['cant move', "can't move", 'cannot move', 'paralyzed', "can't feel my legs", 'cant feel legs', 'no feeling'])) {
      answers.trauma_mobility = 'No';
    }
  }

  if (type === 'respiratory') {
    if (includesAny(text, ['choking', 'airway', 'stuck in throat'])) {
      answers.breathing_detail = 'Choking / Airway obstruction';
    } else if (includesAny(text, ['blue lips', 'turning blue', 'cyanosis', 'blue fingertips'])) {
      answers.breathing_detail = 'Lips or fingertips turning blue';
    } else if (includesAny(text, ['wheezing', 'asthma'])) {
      answers.breathing_detail = 'Wheezing / Asthma-like';
    } else if (includesAny(text, ['cant finish', 'cant speak full', "can't speak", 'few words', 'cant talk'])) {
      answers.breathing_detail = 'Cannot speak full sentences';
    } else if (includesAny(text, ['rapid', 'fast breathing', 'shallow', 'panting', 'hyperventilat'])) {
      answers.breathing_detail = 'Rapid shallow breathing';
    }
  }

  if (type === 'neurological') {
    if (includesAny(text, ['still seizing', 'currently seizing', 'seizing now', 'convulsing now'])) {
      answers.seizure_status = 'Currently seizing';
    } else if (includesAny(text, ['multiple seizures', 'back to back', 'several seizures', 'one after another'])) {
      answers.seizure_status = 'Multiple seizures in a row';
    } else if (includesAny(text, ['first seizure', 'first time', 'never had'])) {
      answers.seizure_status = 'First-time seizure';
    } else if (includesAny(text, ['epileptic', 'epilepsy', 'known seizure'])) {
      answers.seizure_status = 'Known epilepsy — breakthrough seizure';
    } else if (includesAny(text, ['just ended', 'after seizure', 'confused now', 'postictal'])) {
      answers.seizure_status = 'Seizure just ended, patient confused';
    }
  }

  if (type === 'obstetric') {
    if (includesAny(text, ['heavy bleeding', 'vaginal bleeding', 'bleeding heavily'])) {
      answers.pregnancy_complication = 'Heavy vaginal bleeding';
    } else if (includesAny(text, ['water broke', 'membrane', 'water broken'])) {
      answers.pregnancy_complication = 'Water broke / Membrane rupture';
    } else if (includesAny(text, ['contractions', 'labor', 'labour', 'giving birth'])) {
      answers.pregnancy_complication = 'Active labor / Contractions';
    } else if (includesAny(text, ['severe abdominal', 'severe stomach', 'bad cramps'])) {
      answers.pregnancy_complication = 'Severe abdominal pain';
    } else if (includesAny(text, ['high blood pressure', 'seizure', 'eclampsia'])) {
      answers.pregnancy_complication = 'High blood pressure / Seizures';
    } else if (includesAny(text, ['not moving', 'no movement', 'baby not moving', 'fetal movement'])) {
      answers.pregnancy_complication = 'Decreased fetal movement';
    }
  }
}

// ── Clarifier generation ──────────────────────────────────────────────────────
// After analysis, the chat asks ONLY for critical info the text did not cover,
// mirroring the depth of the guided flow while keeping the conversation short.

export function buildClarifiers(ex: NlpExtraction): Clarifier[] {
  const out: Clarifier[] = [];
  const a = ex.answers;

  // Vitals always confirmed if unknown.
  if (a.breathing === undefined) {
    out.push({ key: 'breathing', text: 'Is the patient currently breathing?', subtext: 'Check for chest movement or breath sounds', type: 'yes_no' });
  }
  if (a.conscious === undefined) {
    out.push({ key: 'conscious', text: 'Is the patient conscious and responsive?', subtext: 'Do they respond to voice or touch?', type: 'yes_no' });
  }
  if (a.bleeding === undefined) {
    out.push({ key: 'bleeding', text: 'Is there severe or uncontrolled bleeding?', subtext: 'Bleeding that does not stop with direct pressure', type: 'yes_no' });
  }

  // One key type-specific follow-up, when not already extracted.
  if (ex.emergencyType === 'cardiac' && a.chest_pain_type === undefined) {
    out.push({ key: 'chest_pain_type', text: 'How would you describe the chest pain?', type: 'multiple_choice',
      options: ['Crushing / Squeezing pressure', 'Sharp / Stabbing pain', 'Burning sensation', 'Tightness with shortness of breath', 'Radiating to arm, jaw, or back'] });
  }
  if (ex.emergencyType === 'cardiac' && a.chest_pain_duration === undefined) {
    out.push({ key: 'chest_pain_duration', text: 'How long has the chest pain lasted?', type: 'multiple_choice',
      options: ['Just started (less than 5 minutes)', '5–30 minutes', 'More than 30 minutes', 'Comes and goes over hours'] });
  }
  if (ex.emergencyType === 'stroke' && a.stroke_onset === undefined) {
    out.push({ key: 'stroke_onset', text: 'When did the stroke symptoms start?', subtext: 'Critical for treatment decisions', type: 'multiple_choice',
      options: ['Within the last hour', '1–3 hours ago', '3–6 hours ago', 'More than 6 hours ago', 'Unknown / Woke up with symptoms'] });
  }
  if (ex.emergencyType === 'trauma' && a.trauma_mobility === undefined) {
    out.push({ key: 'trauma_mobility', text: 'Can the patient move all limbs?', subtext: 'Possible spinal injury — do not move the patient if unsure', type: 'yes_no' });
  }
  if (ex.emergencyType === 'respiratory' && a.breathing_detail === undefined) {
    out.push({ key: 'breathing_detail', text: 'Which best describes the breathing difficulty?', type: 'multiple_choice',
      options: ['Wheezing / Asthma-like', 'Choking / Airway obstruction', 'Rapid shallow breathing', 'Lips or fingertips turning blue', 'Cannot speak full sentences'] });
  }
  if (ex.emergencyType === 'neurological' && a.seizure_status === undefined) {
    out.push({ key: 'seizure_status', text: 'What is the current seizure status?', type: 'multiple_choice',
      options: ['Currently seizing', 'Seizure just ended, patient confused', 'Multiple seizures in a row', 'First-time seizure', 'Known epilepsy — breakthrough seizure'] });
  }
  if (ex.emergencyType === 'obstetric' && a.pregnancy_complication === undefined) {
    out.push({ key: 'pregnancy_complication', text: 'What complication is occurring?', type: 'multiple_choice',
      options: ['Active labor / Contractions', 'Heavy vaginal bleeding', 'Severe abdominal pain', 'Water broke / Membrane rupture', 'High blood pressure / Seizures', 'Decreased fetal movement'] });
  }

  // Pain, if never mentioned.
  if (a.pain_level === undefined) {
    out.push({ key: 'pain_level', text: 'On a scale of 0–10, how severe is the pain?', type: 'pain_scale' });
  }

  return out;
}

/** Build the "I understood…" acknowledgement sentence shown by the bot. */
export function summarizeExtraction(ex: NlpExtraction): string {
  const parts: string[] = [];
  const typeLabel: Record<EmergencyType, string> = {
    cardiac: 'a cardiac / chest emergency',
    stroke: 'possible stroke symptoms',
    trauma: 'a trauma / injury',
    respiratory: 'a breathing emergency',
    neurological: 'a neurological emergency',
    obstetric: 'a pregnancy-related emergency',
    other: 'a medical emergency',
  };
  if (ex.emergencyType !== 'other' || ex.keywords.length > 0) {
    parts.push(`Got it — this looks like ${typeLabel[ex.emergencyType]}.`);
  } else {
    parts.push("Thanks. I couldn't pinpoint a specific category, so I'll ask a few quick questions.");
  }
  const symptoms = ex.keywords.filter((k) => k.category === 'symptom' || k.category === 'emergency').map((k) => k.label);
  if (symptoms.length) parts.push(`I picked up: ${symptoms.slice(0, 6).join(', ')}.`);
  if (ex.redFlags.length) parts.push(`⚠️ ${ex.redFlags.join('; ')}.`);
  return parts.join(' ');
}
