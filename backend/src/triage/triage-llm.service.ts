import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenAI, Type } from '@google/genai';
import { ConverseMessageDto } from './dto/triage-converse.dto';

/**
 * Triage LLM Service (Google Gemini)
 * ----------------------------------------------------------------------------
 * Natural-language layer for the emergency triage chat. Gemini handles the
 * conversation: it reads the running transcript, extracts the structured
 * triage `answers` map, decides the single most important next question, and
 * writes a natural, empathetic reply + tappable quick-reply options.
 *
 * The deterministic clinical inference (severity, ambulance class, hospital)
 * still runs in triageEngine.ts on the client — Gemini only does the
 * understanding + conversation steering. This keeps the medical decision
 * auditable and rule-based while the intake feels like a real chat.
 *
 * If no GEMINI_API_KEY is configured (or the API errors), `available` is false
 * and the client falls back to its offline rule-based engine.
 */

// ── Allowed enum values — MUST match the client triageEngine.ts options ───────

const YES_NO = ['Yes', 'No'];
const EMERGENCY_TYPE = [
  'Chest pain / Heart problem',
  'Stroke symptoms (face drooping, arm weakness, speech difficulty)',
  'Accident / Injury / Trauma',
  'Breathing difficulty / Respiratory distress',
  'Seizure / Neurological issue',
  'Pregnancy / Childbirth complication',
  'Other medical emergency',
];
const CHEST_PAIN_TYPE = [
  'Crushing / Squeezing pressure',
  'Sharp / Stabbing pain',
  'Burning sensation',
  'Tightness with shortness of breath',
  'Radiating to arm, jaw, or back',
];
const CHEST_PAIN_DURATION = [
  'Just started (less than 5 minutes)',
  '5–30 minutes',
  'More than 30 minutes',
  'Comes and goes over hours',
];
const STROKE_ONSET = [
  'Within the last hour',
  '1–3 hours ago',
  '3–6 hours ago',
  'More than 6 hours ago',
  'Unknown / Woke up with symptoms',
];
const STROKE_SYMPTOMS = [
  'Face drooping on one side',
  'Arm weakness / Cannot lift both arms',
  'Speech difficulty / Slurred speech',
  'Sudden severe headache',
  'Vision problems',
  'Multiple of the above',
];
const TRAUMA_TYPE = [
  'Vehicle accident (car, motorcycle, bicycle)',
  'Fall from height',
  'Penetrating injury (stab, gunshot)',
  'Blunt force / Assault',
  'Burns (fire, chemical, electrical)',
  'Drowning / Near-drowning',
  'Other injury',
];
const BREATHING_DETAIL = [
  'Wheezing / Asthma-like',
  'Choking / Airway obstruction',
  'Rapid shallow breathing',
  'Lips or fingertips turning blue',
  'Cannot speak full sentences',
];
const SEIZURE_STATUS = [
  'Currently seizing',
  'Seizure just ended, patient confused',
  'Multiple seizures in a row',
  'First-time seizure',
  'Known epilepsy — breakthrough seizure',
];
const PREGNANCY_WEEK = [
  'Less than 20 weeks',
  '20–32 weeks',
  '32–37 weeks',
  '37+ weeks (full term)',
  'Unknown',
];
const PREGNANCY_COMPLICATION = [
  'Active labor / Contractions',
  'Heavy vaginal bleeding',
  'Severe abdominal pain',
  'Water broke / Membrane rupture',
  'High blood pressure / Seizures',
  'Decreased fetal movement',
];
const PAIN_LEVELS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];

// ── Response shape returned to the client ─────────────────────────────────────

export interface TriageConverseResult {
  available: boolean;
  /** Natural assistant message (contains the next question if not done). */
  reply: string;
  /** Full triage answers inferred from the ENTIRE conversation so far. */
  answers: Record<string, string>;
  /** Tappable quick replies for the current question (may be empty). */
  quickReplies: string[];
  /** What input control the UI should surface. */
  inputType: 'yes_no' | 'choice' | 'pain' | 'text' | 'none';
  /** Detected keywords for hospital matching / chips. */
  keywords: string[];
  /** True when enough has been gathered to finalize the assessment. */
  done: boolean;
}

@Injectable()
export class TriageLlmService {
  private readonly logger = new Logger(TriageLlmService.name);
  private readonly client: GoogleGenAI | null;
  private readonly model: string;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    this.model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    this.client = apiKey ? new GoogleGenAI({ apiKey }) : null;
    if (!this.client) {
      this.logger.warn(
        'GEMINI_API_KEY not set — /triage/converse will report unavailable; client uses offline fallback.',
      );
    }
  }

  get isAvailable(): boolean {
    return this.client !== null;
  }

  async converse(
    messages: ConverseMessageDto[],
    lang?: string,
  ): Promise<TriageConverseResult> {
    if (!this.client) {
      return this.unavailable();
    }

    // Map the transcript to Gemini's content format. Gemini expects the first
    // turn to be the user; drop any leading assistant turns (e.g. the static
    // welcome message the client shows but doesn't send).
    const contents = messages
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.text }],
      }))
      .filter((_, i, arr) => !(i === 0 && arr[i].role === 'model'));

    if (contents.length === 0) {
      return this.unavailable();
    }

    // Localise the assistant's natural-language output without touching the
    // canonical English answer values the clinical engine depends on.
    const cleanLang = (lang || '').trim();
    const systemInstruction =
      cleanLang && cleanLang.toLowerCase() !== 'english'
        ? `${SYSTEM_PROMPT}\n\nLANGUAGE: Write "reply" and every string in "quick_replies" in ${cleanLang}. The caller speaks ${cleanLang}. IMPORTANT: keep all values inside the "answers" object EXACTLY as the English allowed values listed above — do NOT translate answer values or keywords.`
        : SYSTEM_PROMPT;

    try {
      const response = await this.client.models.generateContent({
        model: this.model,
        contents,
        config: {
          systemInstruction,
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
        },
      });

      const text = response.text;
      if (!text) return this.unavailable();

      const parsed = JSON.parse(text);
      const userText = messages
        .filter((m) => m.role === 'user')
        .map((m) => m.text)
        .join(' ')
        .toLowerCase();
      // Did the assistant ask a pain-scale question? If so, a bare numeric
      // reply is a legitimate pain_level (not a hallucination).
      const painSolicited = messages.some(
        (m) =>
          m.role === 'assistant' &&
          /pain/.test(m.text.toLowerCase()) &&
          /\b0\b|scale|\b10\b|how (bad|severe)|rate/.test(m.text.toLowerCase()),
      );
      let answers = this.sanitizeAnswers(parsed.answers, userText, painSolicited);
      // Deterministic backfill: fill high-impact category detail fields the LLM
      // may have omitted, from the transcript (LLM + rules hybrid).
      answers = this.backfillDetails(answers, userText);

      return {
        available: true,
        reply: String(parsed.reply || 'Can you tell me more about what is happening?'),
        answers,
        quickReplies: Array.isArray(parsed.quick_replies)
          ? parsed.quick_replies.map(String).slice(0, 8)
          : [],
        inputType: this.normalizeInputType(parsed.input_type),
        keywords: Array.isArray(parsed.keywords)
          ? parsed.keywords.map(String).slice(0, 12)
          : [],
        done: Boolean(parsed.done),
      };
    } catch (err) {
      this.logger.error(`Gemini converse failed: ${err?.message || err}`);
      return this.unavailable();
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private unavailable(): TriageConverseResult {
    return {
      available: false,
      reply: '',
      answers: {},
      quickReplies: [],
      inputType: 'text',
      keywords: [],
      done: false,
    };
  }

  private normalizeInputType(t: any): TriageConverseResult['inputType'] {
    const allowed = ['yes_no', 'choice', 'pain', 'text', 'none'];
    return allowed.includes(t) ? t : 'text';
  }

  /**
   * Keep only known keys, coerce to strings, snap pain_level into 0–10, and
   * drop category-specific detail fields that don't match the chosen
   * emergency_type (defends against the model over-filling unrelated fields,
   * e.g. inventing trauma_type for a cardiac case).
   */
  private sanitizeAnswers(raw: any, userText = '', painSolicited = false): Record<string, string> {
    const out: Record<string, string> = {};
    if (!raw || typeof raw !== 'object') return out;

    // Fields that are always valid regardless of emergency type.
    const COMMON = new Set([
      'breathing', 'conscious', 'bleeding', 'emergency_type',
      'pain_level', 'pregnant_check', 'chief_complaint',
    ]);
    // Detail fields keyed by the emergency_type they belong to.
    const DETAIL_BY_TYPE: Record<string, string[]> = {
      cardiac: ['chest_pain_type', 'chest_pain_duration'],
      stroke: ['stroke_onset', 'stroke_symptoms'],
      trauma: ['trauma_type', 'trauma_mobility'],
      respiratory: ['breathing_detail'],
      neurological: ['seizure_status'],
      obstetric: ['pregnancy_week', 'pregnancy_complication'],
    };

    const etype = this.mapType(String(raw.emergency_type || ''));
    const allowedDetail = new Set(DETAIL_BY_TYPE[etype] ?? []);

    for (const [k, v] of Object.entries(raw)) {
      if (v == null || v === '') continue;
      const known = COMMON.has(k) || Object.values(DETAIL_BY_TYPE).some((a) => a.includes(k));
      if (!known) continue;
      // Drop a detail field that belongs to a different category than the one chosen.
      const isDetail = !COMMON.has(k);
      if (isDetail && !allowedDetail.has(k)) continue;
      out[k] = String(v);
    }

    // Grounding guards: drop hallucinated cross-cutting fields the caller
    // never actually provided.
    if (out.pregnant_check && !/pregn|labou?r|contraction|water broke|fetal|trimester|weeks pregnant/.test(userText)) {
      delete out.pregnant_check;
    }
    if (out.pain_level != null) {
      const ratingMentioned =
        painSolicited ||
        /(\d+)\s*(?:\/|out of)\s*10|\b(no pain|painless|mild|moderate|severe|excruciating|unbearable|worst|intense|agoniz|agony|killing me)\b/.test(userText);
      if (!ratingMentioned) {
        delete out.pain_level;
      } else {
        const n = parseInt(out.pain_level, 10);
        if (Number.isNaN(n)) delete out.pain_level;
        else out.pain_level = String(Math.max(0, Math.min(10, n)));
      }
    }
    return out;
  }

  /**
   * Fill missing category-detail fields from the transcript for the chosen
   * emergency type. Only ADDS fields the LLM omitted — never overrides.
   */
  private backfillDetails(answers: Record<string, string>, text: string): Record<string, string> {
    const a = { ...answers };
    const etype = this.mapType(a.emergency_type || '');
    const has = (re: RegExp) => re.test(text);
    const mins = this.parseMinutes(text);

    if (etype === 'cardiac') {
      if (!a.chest_pain_type) {
        if (has(/crush|squeez|pressure|elephant|heavy/)) a.chest_pain_type = 'Crushing / Squeezing pressure';
        else if (has(/radiat|down (my|the) arm|left arm|jaw|into (my|the) back/)) a.chest_pain_type = 'Radiating to arm, jaw, or back';
        else if (has(/tight|short(ness)? of breath|can'?t breathe/)) a.chest_pain_type = 'Tightness with shortness of breath';
        else if (has(/burning/)) a.chest_pain_type = 'Burning sensation';
        else if (has(/sharp|stab/)) a.chest_pain_type = 'Sharp / Stabbing pain';
      }
      if (!a.chest_pain_duration) {
        if (has(/comes and goes|on and off|on-and-off|intermittent/)) a.chest_pain_duration = 'Comes and goes over hours';
        else if (mins != null) a.chest_pain_duration = mins < 5 ? 'Just started (less than 5 minutes)' : mins <= 30 ? '5–30 minutes' : 'More than 30 minutes';
      }
    } else if (etype === 'stroke') {
      if (!a.stroke_onset) {
        if (has(/woke up|woken up/)) a.stroke_onset = 'Unknown / Woke up with symptoms';
        else if (mins != null) a.stroke_onset = mins <= 60 ? 'Within the last hour' : mins <= 180 ? '1–3 hours ago' : mins <= 360 ? '3–6 hours ago' : 'More than 6 hours ago';
      }
      if (!a.stroke_symptoms) {
        const sx = [/face droop|drooping face|facial droop/, /arm weak|weak arm|can'?t lift/, /slurred|speech|can'?t speak/, /headache/, /vision|blurred|can'?t see/].filter((re) => has(re)).length;
        if (sx >= 2) a.stroke_symptoms = 'Multiple of the above';
        else if (has(/face droop|drooping face|facial droop/)) a.stroke_symptoms = 'Face drooping on one side';
        else if (has(/arm weak|weak arm|can'?t lift/)) a.stroke_symptoms = 'Arm weakness / Cannot lift both arms';
        else if (has(/slurred|speech/)) a.stroke_symptoms = 'Speech difficulty / Slurred speech';
        else if (has(/headache/)) a.stroke_symptoms = 'Sudden severe headache';
        else if (has(/vision|blurred|can'?t see/)) a.stroke_symptoms = 'Vision problems';
      }
    } else if (etype === 'trauma') {
      if (!a.trauma_type) {
        if (has(/car|motorcycle|bike|vehicle|crash|collision|road accident|hit by/)) a.trauma_type = 'Vehicle accident (car, motorcycle, bicycle)';
        else if (has(/fell|fall|slipped/)) a.trauma_type = 'Fall from height';
        else if (has(/stab|gunshot|shot|knife|impaled/)) a.trauma_type = 'Penetrating injury (stab, gunshot)';
        else if (has(/burn|scald|on fire|electrocut|chemical/)) a.trauma_type = 'Burns (fire, chemical, electrical)';
        else if (has(/drown|near.drowning/)) a.trauma_type = 'Drowning / Near-drowning';
        else if (has(/assault|beaten|punch|attack/)) a.trauma_type = 'Blunt force / Assault';
      }
      if (!a.trauma_mobility && has(/can'?t move|cannot move|paralyz|can'?t feel (my|his|her) leg|no feeling/)) a.trauma_mobility = 'No';
    } else if (etype === 'respiratory') {
      if (!a.breathing_detail) {
        if (has(/chok|airway|stuck in (my|the) throat/)) a.breathing_detail = 'Choking / Airway obstruction';
        else if (has(/blue lip|turning blue|cyanos|blue finger/)) a.breathing_detail = 'Lips or fingertips turning blue';
        else if (has(/wheez|asthma/)) a.breathing_detail = 'Wheezing / Asthma-like';
        else if (has(/can'?t (speak|finish|talk)|few words/)) a.breathing_detail = 'Cannot speak full sentences';
        else if (has(/rapid|fast breathing|shallow|panting|hyperventilat/)) a.breathing_detail = 'Rapid shallow breathing';
      }
    } else if (etype === 'neurological') {
      if (!a.seizure_status) {
        if (has(/still seizing|currently seizing|seizing now|convulsing now/)) a.seizure_status = 'Currently seizing';
        else if (has(/multiple seizure|back to back|several seizure|one after another/)) a.seizure_status = 'Multiple seizures in a row';
        else if (has(/first seizure|first time|never had/)) a.seizure_status = 'First-time seizure';
        else if (has(/epilep|known seizure/)) a.seizure_status = 'Known epilepsy — breakthrough seizure';
        else if (has(/just ended|after (the )?seizure|confused now|postictal/)) a.seizure_status = 'Seizure just ended, patient confused';
      }
    } else if (etype === 'obstetric') {
      if (!a.pregnancy_complication) {
        if (has(/heavy bleeding|vaginal bleeding|bleeding heavily/)) a.pregnancy_complication = 'Heavy vaginal bleeding';
        else if (has(/water broke|membrane|water broken/)) a.pregnancy_complication = 'Water broke / Membrane rupture';
        else if (has(/contraction|in labou?r|giving birth/)) a.pregnancy_complication = 'Active labor / Contractions';
        else if (has(/severe abdominal|severe stomach|bad cramp/)) a.pregnancy_complication = 'Severe abdominal pain';
        else if (has(/high blood pressure|eclampsia/)) a.pregnancy_complication = 'High blood pressure / Seizures';
        else if (has(/not moving|no movement|baby not moving|fetal movement/)) a.pregnancy_complication = 'Decreased fetal movement';
      }
    }
    return a;
  }

  /** Parse an approximate duration in minutes from free text. */
  private parseMinutes(text: string): number | null {
    const m = text.match(/(\d+(?:\.\d+)?)\s*(min|mins|minute|minutes|hour|hours|hr|hrs)/);
    if (m) {
      const v = parseFloat(m[1]);
      return /^h/.test(m[2]) ? v * 60 : v;
    }
    if (/half an hour|half hour/.test(text)) return 30;
    if (/\ban hour\b|\bone hour\b/.test(text)) return 60;
    if (/few minutes|couple of minutes|just (started|now|began)|moments ago/.test(text)) return 2;
    return null;
  }

  private mapType(answer: string): string {
    if (answer.startsWith('Chest pain')) return 'cardiac';
    if (answer.startsWith('Stroke')) return 'stroke';
    if (answer.startsWith('Accident')) return 'trauma';
    if (answer.startsWith('Breathing')) return 'respiratory';
    if (answer.startsWith('Seizure')) return 'neurological';
    if (answer.startsWith('Pregnancy')) return 'obstetric';
    return 'other';
  }
}

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an AI emergency medical triage intake assistant for an ambulance booking system. A caller is reporting an emergency. Your job is to understand what is happening through natural conversation and extract structured triage data.

CONVERSATION STYLE:
- Be calm, warm, and concise. One focused question at a time.
- React briefly to what the caller just said before asking the next question (e.g. "Okay, chest pain for 30 minutes — that's important.").
- Never give medical treatment advice or diagnoses. You only gather information and route the ambulance. If the situation sounds life-threatening, reassure them that help is being arranged.
- The caller may type freely OR tap a quick-reply button. Always provide quick_replies that map to the allowed options so they can tap, but also accept free text.

EXTRACTION — fill the "answers" object using ONLY these fields and EXACT allowed values. Map the caller's words to the closest allowed value (e.g. "my chest feels like an elephant is sitting on it" -> chest_pain_type "Crushing / Squeezing pressure"; "30 mins" -> chest_pain_duration "5–30 minutes").

CRITICAL EXTRACTION RULES:
- Only include a field if the caller has ACTUALLY stated or clearly implied it. If you do not know a field, OMIT it entirely — do NOT guess, and do NOT fill it with a default.
- NEVER invent pain_level. Only include pain_level if the caller described or rated the pain (e.g. "severe", "8 out of 10"). Otherwise omit it and ask.
- Only include detail fields for the chosen emergency_type. For a chest/heart problem, never include trauma_*, stroke_*, breathing_detail, seizure_status, or pregnancy_* fields — and vice versa.
- Descriptive language DOES count as stated — capture it: "crushing chest pain" -> chest_pain_type "Crushing / Squeezing pressure"; "for 30 minutes" -> chest_pain_duration "5–30 minutes"; "stabbing pain" -> chest_pain_type "Sharp / Stabbing pain"; "face is drooping and slurred speech" -> stroke_symptoms "Multiple of the above". Whenever the caller describes the nature or duration of the problem, fill the matching detail field — do not wait to ask about something already described.
- Re-derive the full set of KNOWN answers from the ENTIRE conversation each turn (carry forward everything already established, including details from earlier messages), but still omit anything genuinely unknown.

Allowed fields and values:
- breathing: "Yes" | "No"  (is the patient breathing)
- conscious: "Yes" | "No"  (is the patient conscious/responsive)
- bleeding: "Yes" | "No"   (severe or uncontrolled bleeding)
- emergency_type: one of [${EMERGENCY_TYPE.map((s) => `"${s}"`).join(', ')}]
- chest_pain_type: one of [${CHEST_PAIN_TYPE.map((s) => `"${s}"`).join(', ')}]
- chest_pain_duration: one of [${CHEST_PAIN_DURATION.map((s) => `"${s}"`).join(', ')}]
- stroke_onset: one of [${STROKE_ONSET.map((s) => `"${s}"`).join(', ')}]
- stroke_symptoms: one of [${STROKE_SYMPTOMS.map((s) => `"${s}"`).join(', ')}]
- trauma_type: one of [${TRAUMA_TYPE.map((s) => `"${s}"`).join(', ')}]
- trauma_mobility: "Yes" | "No"  (can the patient move all limbs)
- breathing_detail: one of [${BREATHING_DETAIL.map((s) => `"${s}"`).join(', ')}]
- seizure_status: one of [${SEIZURE_STATUS.map((s) => `"${s}"`).join(', ')}]
- pregnancy_week: one of [${PREGNANCY_WEEK.map((s) => `"${s}"`).join(', ')}]
- pregnancy_complication: one of [${PREGNANCY_COMPLICATION.map((s) => `"${s}"`).join(', ')}]
- pain_level: a string "0".."10" (patient's pain, 0 none .. 10 worst)
- pregnant_check: "Yes" | "No"
- chief_complaint: a short free-text summary of the emergency in the caller's words

WHAT TO ASK NEXT (priority order — ask only what is still unknown):
1. Immediate life threats first if not yet known: breathing, then conscious, then bleeding.
2. emergency_type (the category) if unknown.
3. The key follow-up for that category if unknown: cardiac -> chest_pain_type then chest_pain_duration; stroke -> stroke_onset; trauma -> trauma_type then trauma_mobility; respiratory -> breathing_detail; neurological -> seizure_status; obstetric -> pregnancy_complication then pregnancy_week.
4. pain_level if unknown.
Skip anything already answered or clearly implied. Do not re-ask. Be efficient — aim to finish in as few questions as possible.

input_type for the current question:
- "yes_no" for a Yes/No question
- "choice" for a multiple-choice question (put the choices in quick_replies)
- "pain" for the 0–10 pain scale
- "text" for an open question
- "none" when done is true

keywords: short list of the salient clinical terms detected so far (e.g. "chest pain", "vomiting", "30 min", "sweating") — used for hospital matching and chips.

done: set true once you have breathing, conscious, bleeding, emergency_type, the key category follow-up, and pain_level (or the caller indicates they cannot provide more). When done is true, write a brief reassuring closing reply (e.g. "Thank you — I have what I need. Arranging the ambulance now."), set input_type "none", and quick_replies to [].

Always respond with the JSON object only.`;

// ── Structured-output schema (Gemini responseSchema) ──────────────────────────

const answerProp = (values?: string[]) =>
  values ? { type: Type.STRING, enum: values } : { type: Type.STRING };

const RESPONSE_SCHEMA: any = {
  type: Type.OBJECT,
  properties: {
    reply: { type: Type.STRING },
    answers: {
      type: Type.OBJECT,
      properties: {
        breathing: answerProp(YES_NO),
        conscious: answerProp(YES_NO),
        bleeding: answerProp(YES_NO),
        emergency_type: answerProp(EMERGENCY_TYPE),
        chest_pain_type: answerProp(CHEST_PAIN_TYPE),
        chest_pain_duration: answerProp(CHEST_PAIN_DURATION),
        stroke_onset: answerProp(STROKE_ONSET),
        stroke_symptoms: answerProp(STROKE_SYMPTOMS),
        trauma_type: answerProp(TRAUMA_TYPE),
        trauma_mobility: answerProp(YES_NO),
        breathing_detail: answerProp(BREATHING_DETAIL),
        seizure_status: answerProp(SEIZURE_STATUS),
        pregnancy_week: answerProp(PREGNANCY_WEEK),
        pregnancy_complication: answerProp(PREGNANCY_COMPLICATION),
        pain_level: answerProp(PAIN_LEVELS),
        pregnant_check: answerProp(YES_NO),
        chief_complaint: answerProp(),
      },
    },
    quick_replies: { type: Type.ARRAY, items: { type: Type.STRING } },
    input_type: {
      type: Type.STRING,
      enum: ['yes_no', 'choice', 'pain', 'text', 'none'],
    },
    keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
    done: { type: Type.BOOLEAN },
  },
  required: ['reply', 'answers', 'quick_replies', 'input_type', 'keywords', 'done'],
};
