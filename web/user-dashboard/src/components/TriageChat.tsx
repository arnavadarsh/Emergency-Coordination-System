import { useState, useEffect, useRef, useCallback } from 'react';
import '../styles/TriageChat.css';
import {
  buildState,
  generateTriageResult,
  getSeverityEmoji,
  getAmbulanceTypeLabel,
  type TriageResult,
  type SeverityLevel,
} from '../services/triageEngine';
import {
  analyzeText,
  buildClarifiers,
  summarizeExtraction,
  type Clarifier,
} from '../services/nlpTriage';
import { converse, type ConverseMessage } from '../services/triageApi';
import MedicalProfilePanel from './MedicalProfilePanel';
import {
  medicalProfileAlerts,
  normalizeMedicalProfile,
  type MedicalProfile,
} from '../types/medicalProfile';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  type: 'system' | 'user';
  text: string;
  subtext?: string;
  chips?: string[];
  /** Transient UI notices (offline switch, fast-track banner). Excluded from
   *  the transcript sent to the LLM so they don't pollute its context. */
  transient?: boolean;
  /** Optional Google-Maps link rendered as an action button (location share). */
  mapUrl?: string;
}

/** Live location captured in the chat. */
export interface SharedLocation {
  lat: number;
  lng: number;
  accuracy?: number;
}

interface TriageChatProps {
  /**
   * The patient's Medical Profile, read from their profile record. Shown
   * alongside the triage conversation and repeated in the assessment summary so
   * the responder never has to leave the triage screen to check for allergies,
   * existing conditions or current medication. Supporting information only — it
   * does not feed the triage scoring.
   */
  medicalProfile?: MedicalProfile | null;
  /** Patient's name, shown on the Medical Profile panel header. */
  patientName?: string;
  onComplete: (result: TriageResult) => void;
  /** Fired the moment a CRITICAL life-threat is detected, so the parent can
   *  dispatch an ambulance immediately (before the full Q&A finishes). */
  onFastTrack?: (result: TriageResult) => void;
  /** Fired when the caller shares their live GPS location, so the parent can
   *  pre-fill the booking pickup. */
  onLocation?: (loc: SharedLocation) => void;
  /** Fired when the caller taps "Track ambulance" on the success screen, so the
   *  parent can open the live tracking view. */
  onTrack?: () => void;
}

type Engine = 'llm' | 'local';
type InputType = 'yes_no' | 'choice' | 'pain' | 'text' | 'none';

// ── Internationalisation ──────────────────────────────────────────────────────
// The deterministic clinical engine works in English; here we localise the
// chat UI chrome, drive the speech-recognition / speech-synthesis language, and
// ask Gemini to reply in the caller's language (answer values stay canonical).

type LangCode = 'en' | 'hi' | 'es' | 'fr';

// Languages shown in the selector. Spanish/French translations still live in
// STRINGS + QUICK_STARTS below — re-add their entries here to re-enable them.
const LANGS: { code: LangCode; native: string; bcp47: string; llmName: string }[] = [
  { code: 'en', native: 'English', bcp47: 'en-US', llmName: 'English' },
  { code: 'hi', native: 'हिन्दी', bcp47: 'hi-IN', llmName: 'Hindi' },
];

interface UIStrings {
  welcome: string;
  welcomeSub: string;
  restartWelcome: string;
  quickStart: string;
  placeholder: string;
  placeholderQuick: string;
  placeholderListening: string;
  tapAnswer: string;
  thinking: string;
  offlineNotice: string;
  fastTrackMsg: string;
  fastTrackBanner: string;
  emergencyBar: string;
  callBtn: (n: string) => string;
  hintVoiceOn: string;
  hintVoiceOff: string;
  hintTextOnly: string;
  noPain: string;
  worstPain: string;
  confirmPain: (n: number) => string;
  shareLocation: string;
  locating: string;
  locationShared: string;
  locationError: string;
  openMap: string;
  subtitleLlm: string;
  subtitleLocal: string;
  assessmentReady: string;
  seeResult: string;
  closeResult: string;
  ambulanceOnWay: string;
  ambulanceOnWaySub: string;
  trackAmbulance: string;
}

const STRINGS: Record<LangCode, UIStrings> = {
  en: {
    welcome: "Emergency Triage AI. Tell me what's happening — what's wrong, when it started, and any symptoms. Tap the mic to talk, or type. I'll ask anything else I need.",
    welcomeSub: 'e.g. "My father has crushing chest pain for the last 30 minutes and he\'s sweating and vomiting"',
    restartWelcome: 'Triage restarted. Describe the emergency in your own words, or tap the mic to talk.',
    quickStart: 'Common emergencies — tap to start',
    placeholder: 'Describe the emergency or answer here…',
    placeholderQuick: 'Tap an option above, or type / speak…',
    placeholderListening: 'Listening…',
    tapAnswer: 'Tap an answer',
    thinking: 'Thinking…',
    offlineNotice: 'Using offline triage mode.',
    fastTrackMsg: "⚠ Critical emergency detected — an ambulance is being dispatched right now. Please stay with me; I'll keep asking a few questions so responders arrive fully prepared.",
    fastTrackBanner: '⚠ Ambulance dispatched — keeping the line open to gather details for responders.',
    emergencyBar: "Life-threatening, or app not responding? Don't wait for the assessment.",
    callBtn: (n) => `Call ${n}`,
    hintVoiceOn: "🎙️ Hands-free on — I'll listen after each question. Toggle off to type.",
    hintVoiceOff: 'Tap 🎤 to speak once, or turn on Voice mode for hands-free.',
    hintTextOnly: 'Type your answer and press Enter.',
    noPain: '0 — No pain',
    worstPain: '10 — Worst pain',
    confirmPain: (n) => `Confirm: ${n}/10`,
    shareLocation: '📍 Share my location',
    locating: 'Getting your location…',
    locationShared: '📍 Location shared with dispatch',
    locationError: "Couldn't get your location — please describe it instead.",
    openMap: 'Open in Maps',
    subtitleLlm: 'Conversational AI assessment',
    subtitleLocal: 'Offline rule-based assessment',
    assessmentReady: 'Assessment complete — your triage result is ready.',
    seeResult: '📋 See assessment result',
    closeResult: 'Close',
    ambulanceOnWay: 'Ambulance is on its way!',
    ambulanceOnWaySub: 'Help has been dispatched. You can track it live.',
    trackAmbulance: '📍 Track ambulance',
  },
  hi: {
    welcome: 'आपातकालीन ट्राइएज AI। बताइए क्या हो रहा है — क्या तकलीफ़ है, कब शुरू हुई, और कौन-कौन से लक्षण हैं। बोलने के लिए माइक दबाएँ, या टाइप करें।',
    welcomeSub: 'उदा. "मेरे पिता को 30 मिनट से सीने में तेज़ दर्द है, पसीना और उल्टी हो रही है"',
    restartWelcome: 'ट्राइएज फिर से शुरू। अपनी बात में आपात स्थिति बताइए, या माइक दबाकर बोलिए।',
    quickStart: 'आम आपात स्थितियाँ — शुरू करने के लिए दबाएँ',
    placeholder: 'आपात स्थिति बताइए या यहाँ उत्तर दीजिए…',
    placeholderQuick: 'ऊपर विकल्प चुनें, या टाइप / बोलें…',
    placeholderListening: 'सुन रहा हूँ…',
    tapAnswer: 'उत्तर चुनें',
    thinking: 'सोच रहा हूँ…',
    offlineNotice: 'ऑफ़लाइन ट्राइएज मोड का उपयोग।',
    fastTrackMsg: '⚠ गंभीर आपात स्थिति — एम्बुलेंस अभी भेजी जा रही है। कृपया साथ रहें; मैं कुछ सवाल पूछता रहूँगा ताकि टीम पूरी तैयारी से पहुँचे।',
    fastTrackBanner: '⚠ एम्बुलेंस भेज दी गई — विवरण जुटाने के लिए लाइन पर बने रहें।',
    emergencyBar: 'जानलेवा स्थिति या ऐप काम नहीं कर रहा? आकलन का इंतज़ार न करें।',
    callBtn: (n) => `${n} पर कॉल करें`,
    hintVoiceOn: '🎙️ हैंड्स-फ्री चालू — हर सवाल के बाद सुनूँगा।',
    hintVoiceOff: 'एक बार बोलने के लिए 🎤 दबाएँ, या वॉइस मोड चालू करें।',
    hintTextOnly: 'अपना उत्तर टाइप करें और Enter दबाएँ।',
    noPain: '0 — दर्द नहीं',
    worstPain: '10 — सबसे ज़्यादा दर्द',
    confirmPain: (n) => `पुष्टि: ${n}/10`,
    shareLocation: '📍 मेरी लोकेशन भेजें',
    locating: 'आपकी लोकेशन ली जा रही है…',
    locationShared: '📍 लोकेशन डिस्पैच को भेज दी गई',
    locationError: 'लोकेशन नहीं मिल पाई — कृपया बताइए।',
    openMap: 'मैप में खोलें',
    subtitleLlm: 'संवादात्मक AI आकलन',
    subtitleLocal: 'ऑफ़लाइन नियम-आधारित आकलन',
    assessmentReady: 'आकलन पूरा — आपका ट्राइएज परिणाम तैयार है।',
    seeResult: '📋 आकलन परिणाम देखें',
    closeResult: 'बंद करें',
    ambulanceOnWay: 'एम्बुलेंस रास्ते में है!',
    ambulanceOnWaySub: 'मदद भेज दी गई है। आप इसे लाइव ट्रैक कर सकते हैं।',
    trackAmbulance: '📍 एम्बुलेंस ट्रैक करें',
  },
  es: {
    welcome: 'IA de triaje de emergencias. Cuéntame qué pasa — qué ocurre, cuándo empezó y qué síntomas hay. Toca el micrófono para hablar o escribe.',
    welcomeSub: 'p. ej. "Mi padre tiene un dolor opresivo en el pecho desde hace 30 minutos y suda y vomita"',
    restartWelcome: 'Triaje reiniciado. Describe la emergencia con tus palabras o toca el micrófono.',
    quickStart: 'Emergencias comunes — toca para empezar',
    placeholder: 'Describe la emergencia o responde aquí…',
    placeholderQuick: 'Toca una opción arriba, o escribe / habla…',
    placeholderListening: 'Escuchando…',
    tapAnswer: 'Toca una respuesta',
    thinking: 'Pensando…',
    offlineNotice: 'Usando modo de triaje sin conexión.',
    fastTrackMsg: '⚠ Emergencia crítica detectada — se está enviando una ambulancia ahora. Quédate conmigo; seguiré con unas preguntas para que el equipo llegue preparado.',
    fastTrackBanner: '⚠ Ambulancia enviada — mantengo la línea para reunir datos.',
    emergencyBar: '¿Peligro de muerte o la app no responde? No esperes la evaluación.',
    callBtn: (n) => `Llamar al ${n}`,
    hintVoiceOn: '🎙️ Manos libres activado — escucharé tras cada pregunta.',
    hintVoiceOff: 'Toca 🎤 para hablar una vez, o activa el modo voz.',
    hintTextOnly: 'Escribe tu respuesta y pulsa Enter.',
    noPain: '0 — Sin dolor',
    worstPain: '10 — Peor dolor',
    confirmPain: (n) => `Confirmar: ${n}/10`,
    shareLocation: '📍 Compartir mi ubicación',
    locating: 'Obteniendo tu ubicación…',
    locationShared: '📍 Ubicación compartida con la central',
    locationError: 'No se pudo obtener tu ubicación — descríbela.',
    openMap: 'Abrir en Mapas',
    subtitleLlm: 'Evaluación conversacional con IA',
    subtitleLocal: 'Evaluación sin conexión basada en reglas',
    assessmentReady: 'Evaluación completa — tu resultado de triaje está listo.',
    seeResult: '📋 Ver resultado de la evaluación',
    closeResult: 'Cerrar',
    ambulanceOnWay: '¡La ambulancia está en camino!',
    ambulanceOnWaySub: 'Se ha enviado ayuda. Puedes seguirla en vivo.',
    trackAmbulance: '📍 Seguir ambulancia',
  },
  fr: {
    welcome: "IA de triage d'urgence. Dites-moi ce qui se passe — le problème, quand ça a commencé et les symptômes. Touchez le micro pour parler ou écrivez.",
    welcomeSub: 'p. ex. « Mon père a une douleur écrasante à la poitrine depuis 30 minutes, il transpire et vomit »',
    restartWelcome: "Triage redémarré. Décrivez l'urgence avec vos mots ou touchez le micro.",
    quickStart: 'Urgences courantes — touchez pour commencer',
    placeholder: "Décrivez l'urgence ou répondez ici…",
    placeholderQuick: 'Touchez une option ci-dessus, ou écrivez / parlez…',
    placeholderListening: 'À l\'écoute…',
    tapAnswer: 'Touchez une réponse',
    thinking: 'Réflexion…',
    offlineNotice: 'Mode de triage hors ligne.',
    fastTrackMsg: "⚠ Urgence critique détectée — une ambulance part maintenant. Restez avec moi ; je continue quelques questions pour que les secours arrivent prêts.",
    fastTrackBanner: "⚠ Ambulance envoyée — je garde la ligne pour recueillir les détails.",
    emergencyBar: "Danger de mort ou appli qui ne répond pas ? N'attendez pas l'évaluation.",
    callBtn: (n) => `Appeler le ${n}`,
    hintVoiceOn: "🎙️ Mains libres activé — j'écoute après chaque question.",
    hintVoiceOff: 'Touchez 🎤 pour parler une fois, ou activez le mode voix.',
    hintTextOnly: 'Tapez votre réponse et appuyez sur Entrée.',
    noPain: '0 — Aucune douleur',
    worstPain: '10 — Pire douleur',
    confirmPain: (n) => `Confirmer : ${n}/10`,
    shareLocation: '📍 Partager ma position',
    locating: 'Récupération de votre position…',
    locationShared: '📍 Position transmise aux secours',
    locationError: "Impossible d'obtenir votre position — décrivez-la.",
    openMap: 'Ouvrir dans Maps',
    subtitleLlm: "Évaluation conversationnelle par IA",
    subtitleLocal: "Évaluation hors ligne basée sur des règles",
    assessmentReady: 'Évaluation terminée — votre résultat de triage est prêt.',
    seeResult: '📋 Voir le résultat',
    closeResult: 'Fermer',
    ambulanceOnWay: "L'ambulance est en route !",
    ambulanceOnWaySub: "Les secours ont été envoyés. Vous pouvez les suivre en direct.",
    trackAmbulance: "📍 Suivre l'ambulance",
  },
};

// One-tap starters shown on the welcome screen. The label is what the caller
// sees AND what gets sent (Gemini understands any language; the offline engine
// understands the English set).
const QUICK_STARTS: { emoji: string; phrases: Record<LangCode, string> }[] = [
  { emoji: '❤️', phrases: { en: 'Chest pain', hi: 'सीने में दर्द', es: 'Dolor en el pecho', fr: 'Douleur à la poitrine' } },
  { emoji: '🫁', phrases: { en: "Can't breathe", hi: 'साँस नहीं आ रही', es: 'No puedo respirar', fr: 'Difficulté à respirer' } },
  { emoji: '🩸', phrases: { en: 'Severe bleeding', hi: 'बहुत खून बह रहा है', es: 'Sangrado intenso', fr: 'Saignement grave' } },
  { emoji: '🚗', phrases: { en: 'Accident / injury', hi: 'दुर्घटना / चोट', es: 'Accidente / lesión', fr: 'Accident / blessure' } },
  { emoji: '🧠', phrases: { en: 'Stroke signs', hi: 'स्ट्रोक के लक्षण', es: 'Signos de derrame', fr: 'Signes d’AVC' } },
  { emoji: '😵', phrases: { en: 'Unconscious', hi: 'बेहोश है', es: 'Inconsciente', fr: 'Inconscient' } },
];

const SEV_COLORS: Record<SeverityLevel, string> = {
  CRITICAL: '#de350b',
  HIGH: '#ff8b00',
  MODERATE: '#ffab00',
  LOW: '#00875a',
};

// Local emergency dispatch number. Change for your region:
// US/Canada 911 · EU & India (unified) 112 · India ambulance 108 · UK 999 · Australia 000.
const EMERGENCY_NUMBER = '911';

// ── Browser speech APIs (feature-detected) ────────────────────────────────────
const SpeechRecognitionImpl: any =
  typeof window !== 'undefined'
    ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    : undefined;
const synth: SpeechSynthesis | undefined =
  typeof window !== 'undefined' ? window.speechSynthesis : undefined;
const STT_SUPPORTED = !!SpeechRecognitionImpl;
const TTS_SUPPORTED = !!synth;

// ── Component ─────────────────────────────────────────────────────────────────

export default function TriageChat({
  medicalProfile,
  patientName,
  onComplete,
  onFastTrack,
  onLocation,
  onTrack,
}: TriageChatProps) {
  // Normalised once so every render — rail, summary — reads the same complete
  // shape, with "Not Provided" already filled in for anything unset.
  const profile = normalizeMedicalProfile(medicalProfile);
  const profileAlerts = medicalProfileAlerts(profile);

  const [engine, setEngine] = useState<Engine>('llm');
  const [lang, setLang] = useState<LangCode>('en');
  const [location, setLocation] = useState<SharedLocation | null>(null);
  const [locating, setLocating] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [isTyping, setIsTyping] = useState(false);
  const [triageResult, setTriageResult] = useState<TriageResult | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [fastTracked, setFastTracked] = useState(false);

  const [quickReplies, setQuickReplies] = useState<string[]>([]);
  const [inputType, setInputType] = useState<InputType>('text');
  const [textValue, setTextValue] = useState('');
  const [painValue, setPainValue] = useState(5);

  const [clarifierQueue, setClarifierQueue] = useState<Clarifier[]>([]);
  const [currentClarifier, setCurrentClarifier] = useState<Clarifier | null>(null);

  // Voice
  const [voiceMode, setVoiceMode] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const answersRef = useRef<Record<string, string>>({});
  const triageResultRef = useRef<TriageResult | null>(null);
  const fastTrackedRef = useRef(false);
  const voiceModeRef = useRef(false);
  const recognitionRef = useRef<any>(null);
  const langRef = useRef<LangCode>('en');
  answersRef.current = answers;
  triageResultRef.current = triageResult;
  voiceModeRef.current = voiceMode;
  langRef.current = lang;

  const t = STRINGS[lang];
  // True until the caller sends their first turn — used to show the welcome
  // quick-start chips and to allow live language switching of the greeting.
  const conversationStarted = messages.some((m) => m.type === 'user');

  const scrollToBottom = useCallback(() => {
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 80);
  }, []);

  // ── Text-to-speech ──
  const speak = useCallback((text: string, thenListen = false) => {
    if (!TTS_SUPPORTED || !synth || !voiceModeRef.current) {
      if (thenListen) startListeningSafe();
      return;
    }
    try {
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text.replace(/[🏥🤖🚨⚙️✦⚠●🩺📍❤️🫁🩸🚗🧠😵🎙️🎤]/g, ''));
      u.lang = LANGS.find((l) => l.code === langRef.current)?.bcp47 || 'en-US';
      u.rate = 1.05;
      u.pitch = 1;
      u.onend = () => { if (thenListen) startListeningSafe(); };
      synth.speak(u);
    } catch {
      if (thenListen) startListeningSafe();
    }
  }, []);

  // ── Speech-to-text ──
  const stopListening = useCallback(() => {
    try { recognitionRef.current?.stop(); } catch { /* noop */ }
    setListening(false);
    setInterim('');
  }, []);

  const startListening = useCallback(() => {
    if (!STT_SUPPORTED || listening || triageResultRef.current) return;
    try {
      const rec = new SpeechRecognitionImpl();
      rec.lang = LANGS.find((l) => l.code === langRef.current)?.bcp47 || 'en-US';
      rec.interimResults = true;
      rec.continuous = false;
      rec.maxAlternatives = 1;
      recognitionRef.current = rec;
      let finalText = '';
      rec.onresult = (e: any) => {
        let interimText = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) finalText += t;
          else interimText += t;
        }
        setInterim(interimText);
        setTextValue((finalText + interimText).trim());
      };
      rec.onerror = () => { setListening(false); setInterim(''); };
      rec.onend = () => {
        setListening(false);
        setInterim('');
        const said = finalText.trim();
        if (said) submitRef.current(said);
      };
      setListening(true);
      rec.start();
    } catch {
      setListening(false);
    }
  }, [listening]);

  // Stable wrapper used inside TTS callbacks.
  const startListeningSafe = () => {
    if (voiceModeRef.current && !triageResultRef.current) {
      setTimeout(() => startListenRef.current(), 250);
    }
  };
  const startListenRef = useRef(startListening);
  startListenRef.current = startListening;

  // ── Init ──
  useEffect(() => {
    setMessages([
      { id: 'welcome', type: 'system', text: STRINGS.en.welcome, subtext: STRINGS.en.welcomeSub },
    ]);
    setInputType('text');
    return () => { try { synth?.cancel(); recognitionRef.current?.abort?.(); } catch { /* noop */ } };
  }, []);

  // Re-localise the greeting when the caller switches language before they've
  // said anything. Once the conversation is underway we leave history intact.
  useEffect(() => {
    if (conversationStarted) return;
    setMessages([{ id: 'welcome', type: 'system', text: STRINGS[lang].welcome, subtext: STRINGS[lang].welcomeSub }]);
  }, [lang, conversationStarted]);

  useEffect(() => { scrollToBottom(); }, [messages, isTyping, scrollToBottom]);

  // ── Fast-track on CRITICAL ──
  const maybeFastTrack = useCallback((merged: Record<string, string>) => {
    if (fastTrackedRef.current || triageResultRef.current || !onFastTrack) return;
    if (buildState(merged).severity !== 'CRITICAL') return;
    fastTrackedRef.current = true;
    setFastTracked(true);
    onFastTrack(generateTriageResult(merged));
    setMessages(prev => [
      ...prev,
      { id: `fasttrack-${Date.now()}`, type: 'system', text: STRINGS[langRef.current].fastTrackMsg, transient: true },
    ]);
  }, [onFastTrack]);

  // ── Finalize ──
  const finalize = useCallback((finalAnswers: Record<string, string>, keywords: string[]) => {
    const result = generateTriageResult(finalAnswers);
    if (keywords.length) {
      result.chiefComplaint = `${result.chiefComplaint}  ·  [keywords: ${[...new Set(keywords)].join(', ')}]`;
    }
    setTriageResult(result);
    triageResultRef.current = result;
    setInputType('none');
    setQuickReplies([]);
    stopListening();
    onComplete(result);
  }, [onComplete, stopListening]);

  // ── Local fallback ──
  const advanceLocalClarifiers = useCallback(
    (queue: Clarifier[], merged: Record<string, string>, keywords: string[]) => {
      if (queue.length === 0) { finalize(merged, keywords); return; }
      const [next, ...rest] = queue;
      setIsTyping(true);
      setTimeout(() => {
        setIsTyping(false);
        setCurrentClarifier(next);
        setClarifierQueue(rest);
        setPainValue(5);
        setInputType(next.type === 'yes_no' ? 'yes_no' : next.type === 'pain_scale' ? 'pain' : 'choice');
        setQuickReplies(next.type === 'yes_no' ? ['Yes', 'No'] : next.options ?? []);
        setMessages(prev => [...prev, { id: `clarify-${next.key}-${Date.now()}`, type: 'system', text: next.text, subtext: next.subtext }]);
        speak(next.text, next.type !== 'multiple_choice');
      }, 450);
    },
    [finalize, speak],
  );

  const runLocalDescription = useCallback((text: string, prevAnswers: Record<string, string>) => {
    setIsTyping(true);
    setTimeout(() => {
      setIsTyping(false);
      const ex = analyzeText(text);
      const merged = { ...prevAnswers, ...ex.answers };
      if (prevAnswers.chief_complaint && ex.answers.chief_complaint) {
        merged.chief_complaint = `${prevAnswers.chief_complaint} ${ex.answers.chief_complaint}`;
      }
      setAnswers(merged);
      maybeFastTrack(merged);
      const kw = ex.keywords.map(k => k.label);
      setMessages(prev => [...prev, { id: `sum-${Date.now()}`, type: 'system', text: summarizeExtraction(ex), chips: kw }]);
      advanceLocalClarifiers(buildClarifiers({ ...ex, answers: merged }), merged, kw);
    }, 500);
  }, [advanceLocalClarifiers, maybeFastTrack]);

  const answerLocalClarifier = useCallback((answer: string) => {
    if (!currentClarifier) return;
    const merged = { ...answersRef.current, [currentClarifier.key]: answer };
    setAnswers(merged);
    maybeFastTrack(merged);
    setCurrentClarifier(null);
    setQuickReplies([]);
    setPainValue(5);
    advanceLocalClarifiers(clarifierQueue, merged, []);
  }, [currentClarifier, clarifierQueue, advanceLocalClarifiers, maybeFastTrack]);

  // ── Submit a turn (typing, mic, or quick-reply tap) ──
  const submitTurn = useCallback(async (raw: string) => {
    const text = raw.trim();
    if (!text || triageResultRef.current) return;
    stopListening();

    setMessages(prev => [...prev, { id: `u-${Date.now()}`, type: 'user', text }]);
    setTextValue('');
    setPainValue(5);
    setQuickReplies([]);

    if (engine === 'local') {
      if (currentClarifier) answerLocalClarifier(text);
      else runLocalDescription(text, answersRef.current);
      return;
    }

    setIsTyping(true);
    const transcript: ConverseMessage[] = [
      // Drop the static welcome + transient UI notices so the LLM only sees
      // the real back-and-forth.
      ...messages
        .filter(m => !m.transient && m.id !== 'welcome')
        .map(m => ({ role: (m.type === 'user' ? 'user' : 'assistant') as 'user' | 'assistant', text: m.text })),
      { role: 'user', text },
    ];

    const resp = await converse(transcript, LANGS.find(l => l.code === langRef.current)?.llmName);
    setIsTyping(false);

    if (!resp.available) {
      setEngine('local');
      setMessages(prev => [...prev, { id: `fallback-${Date.now()}`, type: 'system', text: t.offlineNotice, transient: true }]);
      runLocalDescription(text, answersRef.current);
      return;
    }

    setAnswers(resp.answers);
    maybeFastTrack(resp.answers);
    setMessages(prev => [...prev, { id: `a-${Date.now()}`, type: 'system', text: resp.reply, chips: resp.keywords }]);
    setQuickReplies(resp.quickReplies);
    setInputType(resp.inputType);

    if (resp.done) {
      finalize(resp.answers, resp.keywords);
      speak(resp.reply, false);
    } else {
      // Speak the question, then auto-listen (except for long multi-choice menus).
      speak(resp.reply, resp.inputType !== 'choice');
    }
  }, [engine, messages, currentClarifier, answerLocalClarifier, runLocalDescription, finalize, maybeFastTrack, speak, stopListening]);
  const submitRef = useRef(submitTurn);
  submitRef.current = submitTurn;

  const toggleVoiceMode = () => {
    const next = !voiceMode;
    setVoiceMode(next);
    voiceModeRef.current = next;
    if (!next) { stopListening(); synth?.cancel(); }
  };

  const toggleMic = () => {
    if (listening) stopListening();
    else startListening();
  };

  const handleRestart = useCallback(() => {
    synth?.cancel();
    stopListening();
    fastTrackedRef.current = false;
    triageResultRef.current = null;
    setEngine('llm');
    setAnswers({});
    setTriageResult(null);
    setShowResult(false);
    setFastTracked(false);
    setQuickReplies([]);
    setInputType('text');
    setClarifierQueue([]);
    setCurrentClarifier(null);
    setTextValue('');
    setPainValue(5);
    setLocation(null);
    setLocating(false);
    setMessages([{ id: 'welcome', type: 'system', text: STRINGS[langRef.current].restartWelcome }]);
  }, [stopListening]);

  // ── Share live GPS location ──
  const shareLocation = useCallback(() => {
    if (locating) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setMessages(prev => [...prev, { id: `loc-err-${Date.now()}`, type: 'system', text: STRINGS[langRef.current].locationError, transient: true }]);
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc: SharedLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
        setLocation(loc);
        setLocating(false);
        onLocation?.(loc);
        const mapUrl = `https://www.google.com/maps?q=${loc.lat},${loc.lng}`;
        setMessages(prev => [...prev, {
          id: `loc-${Date.now()}`,
          type: 'system',
          text: STRINGS[langRef.current].locationShared,
          subtext: `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}${loc.accuracy ? ` · ±${Math.round(loc.accuracy)}m` : ''}`,
          mapUrl,
        }]);
      },
      () => {
        setLocating(false);
        setMessages(prev => [...prev, { id: `loc-err-${Date.now()}`, type: 'system', text: STRINGS[langRef.current].locationError, transient: true }]);
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
    );
  }, [locating, onLocation]);

  // ── Input dock ──
  const renderInput = () => {
    if (triageResult || isTyping) return null;
    const painColor = painValue <= 3 ? '#00875a' : painValue <= 6 ? '#ffab00' : painValue <= 8 ? '#ff8b00' : '#de350b';

    return (
      <div className="triage-dock">
        {/* Feature: one-tap quick-start chips on the welcome screen. */}
        {!conversationStarted && quickReplies.length === 0 && inputType !== 'pain' && (
          <div className="triage-quickstart-group">
            <div className="triage-quickstart-label">{t.quickStart}</div>
            <div className="triage-quickstart-chips">
              {QUICK_STARTS.map((qs) => (
                <button
                  key={qs.emoji}
                  className="triage-quickstart-chip"
                  onClick={() => submitTurn(qs.phrases[lang])}
                >
                  <span className="triage-quickstart-emoji">{qs.emoji}</span>
                  {qs.phrases[lang]}
                </button>
              ))}
            </div>
          </div>
        )}

        {quickReplies.length > 0 && inputType !== 'pain' && (
          <div className="triage-quickreplies-group">
            <div className="triage-quickreplies-label">{t.tapAnswer}</div>
            <div className="triage-quickreplies">
              {quickReplies.map((q) => (
                <button key={q} className={`triage-qr-btn ${q === 'Yes' ? 'yes' : q === 'No' ? 'no' : ''}`} onClick={() => submitTurn(q)}>
                  {q === 'Yes' ? '✓ ' : q === 'No' ? '✗ ' : ''}{q}
                </button>
              ))}
            </div>
          </div>
        )}

        {inputType === 'pain' && (
          <div className="triage-pain-scale">
            <div className="triage-pain-value" style={{ color: painColor }}>{painValue}</div>
            <div className="triage-pain-slider-track">
              <input type="range" min="0" max="10" value={painValue} onChange={(e) => setPainValue(parseInt(e.target.value))} className="triage-pain-slider" />
            </div>
            <div className="triage-pain-labels"><span>{t.noPain}</span><span>{t.worstPain}</span></div>
            <button className="triage-pain-submit" onClick={() => submitTurn(String(painValue))}>{t.confirmPain(painValue)}</button>
          </div>
        )}

        <div className={`triage-inputbar ${listening ? 'listening' : ''}`}>
          {STT_SUPPORTED && (
            <button
              className={`triage-mic-btn ${listening ? 'active' : ''}`}
              onClick={toggleMic}
              title={listening ? 'Stop listening' : 'Tap to speak'}
              aria-label="Microphone"
            >
              {listening ? '⏹' : '🎤'}
            </button>
          )}
          <input
            className="triage-inputbar-field"
            type="text"
            placeholder={listening ? t.placeholderListening : quickReplies.length ? t.placeholderQuick : t.placeholder}
            value={listening ? interim || textValue : textValue}
            onChange={(e) => setTextValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && textValue.trim()) { e.preventDefault(); submitTurn(textValue); } }}
          />
          <button className="triage-send-btn" onClick={() => { if (textValue.trim()) submitTurn(textValue); }} disabled={!textValue.trim()} aria-label="Send">
            ➤
          </button>
        </div>

        {/* Feature: share live GPS location with dispatch. */}
        <button
          className={`triage-location-btn ${location ? 'shared' : ''}`}
          onClick={shareLocation}
          disabled={locating || !!location}
        >
          {locating ? `⏳ ${t.locating}` : location ? t.locationShared : t.shareLocation}
        </button>

        <div className="triage-dock-hint">
          {STT_SUPPORTED
            ? voiceMode ? t.hintVoiceOn : t.hintVoiceOff
            : t.hintTextOnly}
        </div>
      </div>
    );
  };

  const severityClass = (s: SeverityLevel) => s.toLowerCase();
  return (
    <div className="triage-chat-wrapper">
      {/* ── Chat Panel ── */}
      <div className="triage-chat-panel">
        <div className="triage-chat-header">
          <div className="triage-chat-header-icon">🩺</div>
          <div className="triage-header-titles">
            <h3>Emergency Triage AI</h3>
            <p>{engine === 'llm' ? t.subtitleLlm : t.subtitleLocal}</p>
          </div>
          <div className="triage-header-controls">
            {/* Feature: multi-language intake. */}
            <select
              className="triage-lang-select"
              value={lang}
              onChange={(e) => setLang(e.target.value as LangCode)}
              aria-label="Language"
              title="Language"
            >
              {LANGS.map((l) => (
                <option key={l.code} value={l.code}>{l.native}</option>
              ))}
            </select>
            {(STT_SUPPORTED || TTS_SUPPORTED) && (
              <div className="triage-mode-switch" role="tablist" aria-label="Input mode">
                <button
                  role="tab"
                  aria-selected={!voiceMode}
                  className={`triage-mode-seg ${!voiceMode ? 'active' : ''}`}
                  onClick={() => { if (voiceMode) toggleVoiceMode(); }}
                  title="Type your answers"
                >
                  Text
                </button>
                <button
                  role="tab"
                  aria-selected={voiceMode}
                  className={`triage-mode-seg ${voiceMode ? 'active' : ''}`}
                  onClick={() => { if (!voiceMode) toggleVoiceMode(); }}
                  title="Hands-free voice mode (speak & listen)"
                >
                  Voice
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Always-visible escape hatch — dials local emergency services directly,
            independent of the AI triage flow. */}
        <div className="triage-emergency-bar">
          <span className="triage-emergency-bar-text">
            {t.emergencyBar}
          </span>
          <a
            className="triage-emergency-call"
            href={`tel:${EMERGENCY_NUMBER}`}
            aria-label={`Call emergency services on ${EMERGENCY_NUMBER}`}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" />
            </svg>
            {t.callBtn(EMERGENCY_NUMBER)}
          </a>
        </div>

        {fastTracked && !triageResult && (
          <div className="triage-fasttrack-banner">
            {t.fastTrackBanner}
          </div>
        )}

        <div className="triage-chat-messages" aria-live="polite" aria-atomic="false">
          {messages.map((msg) => (
            <div key={msg.id} className={`triage-message ${msg.type}`}>
              <div className="triage-message-avatar">{msg.type === 'system' ? '🩺' : '👤'}</div>
              <div className="triage-message-bubble">
                {msg.text}
                {msg.subtext && <span className="triage-message-subtext">{msg.subtext}</span>}
                {msg.mapUrl && (
                  <a className="triage-message-maplink" href={msg.mapUrl} target="_blank" rel="noopener noreferrer">
                    🗺️ {t.openMap}
                  </a>
                )}
                {msg.chips && msg.chips.length > 0 && (
                  <div className="triage-chip-row">
                    {msg.chips.map((c) => (
                      <span key={c} className="triage-chip" style={{ background: '#e6f7f9', color: '#008a9e', borderColor: 'rgba(0,163,191,0.3)' }}>{c}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {isTyping && (
            <div className="triage-typing-indicator">
              <div className="triage-typing-dots"><span></span><span></span><span></span></div>
              <span className="triage-typing-text">{t.thinking}</span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <div className="triage-chat-input-area">
          {triageResult ? (
            <div className="triage-success-panel">
              <div className="triage-success-head">
                <div className="triage-success-icon">🚑</div>
                <div className="triage-success-titles">
                  <strong>{t.ambulanceOnWay}</strong>
                  <span>{t.ambulanceOnWaySub}</span>
                </div>
              </div>
              <div className="triage-success-actions">
                {onTrack && (
                  <button className="triage-track-btn" onClick={onTrack}>{t.trackAmbulance}</button>
                )}
                <button className="triage-see-result-btn" onClick={() => setShowResult(true)}>{t.seeResult}</button>
              </div>
            </div>
          ) : (
            renderInput()
          )}
        </div>
      </div>

      {/* ── Medical Profile rail ──────────────────────────────────────────
          The patient's saved clinical background, alongside the triage
          conversation rather than behind a click, so allergies, conditions and
          medication are in view while the assessment is being made. Read-only —
          it is supporting information and never alters the triage outcome. */}
      <aside className="triage-medical-rail" aria-label="Patient medical profile">
        <div className="triage-medical-rail-head">
          <span aria-hidden="true" style={{ fontSize: '15px' }}>🩺</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h4>Medical Profile</h4>
            <p className="triage-medical-rail-patient">
              {patientName ? `${patientName} · from patient profile` : 'From the patient profile'}
            </p>
          </div>
        </div>

        {profileAlerts.length > 0 && (
          <div className="triage-medical-alerts" role="note">
            <div className="triage-medical-alerts-title">⚠️ Note before treating</div>
            <ul>
              {profileAlerts.map((alert) => <li key={alert}>{alert}</li>)}
            </ul>
          </div>
        )}

        <MedicalProfilePanel
          profile={profile}
          title={null}
          compact
          style={{ border: 'none', padding: 0, background: 'transparent' }}
        />

        <p className="triage-medical-rail-note">
          {profile.hasData
            ? 'Latest details saved by the patient. Update them under Profile → Medical Profile.'
            : 'Nothing recorded yet. The patient can add these under Profile → Medical Profile.'}
        </p>
      </aside>

      {/* ── Result modal (opened from the "See result" button) ── */}
      {triageResult && showResult && (
        <div className="triage-result-modal-overlay" onClick={() => setShowResult(false)} role="dialog" aria-modal="true">
          <div className="triage-result-modal" onClick={(e) => e.stopPropagation()}>
            <button className="triage-result-modal-close" onClick={() => setShowResult(false)} aria-label={t.closeResult}>✕</button>
            <div className="triage-assessment-card">
              <div className={`triage-assessment-header ${severityClass(triageResult.severity)}`}>
                <span style={{ fontSize: '14px' }}>{getSeverityEmoji(triageResult.severity)}</span>
                <h3>Emergency Assessment</h3>
                <span className="severity-label">{triageResult.severity}</span>
              </div>
              <div className="triage-assessment-body">
                {/* Patient Medical Profile — supporting information recorded
                    alongside the assessment, not part of how it was scored. */}
                <div className="triage-assessment-section">
                  <h4>Patient Medical Profile</h4>
                  <MedicalProfilePanel
                    profile={profile}
                    title={null}
                    compact
                    style={{ border: '1px solid #e0e0e0', background: '#fbfcfd' }}
                    footnote={
                      profile.updatedAt
                        ? 'Taken from the patient profile at the time of this assessment.'
                        : 'No medical information on record for this patient.'
                    }
                  />
                </div>

                <div className="triage-assessment-section">
                  <h4>Triage Information</h4>
                  <div className="triage-assessment-grid">
                    <div className="triage-assessment-item">
                      <div className="label">Severity</div>
                      <div className="value" style={{ color: SEV_COLORS[triageResult.severity] }}>{triageResult.severity}</div>
                    </div>
                    <div className="triage-assessment-item">
                      <div className="label">Emergency Type</div>
                      <div className="value" style={{ textTransform: 'capitalize' }}>{triageResult.emergencyType}</div>
                    </div>
                    <div className="triage-assessment-item">
                      <div className="label">Ambulance Type</div>
                      <div className="value">{getAmbulanceTypeLabel(triageResult.ambulance.type)}</div>
                    </div>
                    <div className="triage-assessment-item">
                      <div className="label">Pain Level</div>
                      <div className="value">{triageResult.painLevel}/10</div>
                    </div>
                  </div>
                </div>
                <div className="triage-assessment-section">
                  <h4>Recommended Hospital</h4>
                  <div className="triage-assessment-item" style={{ background: '#e3fcef', borderColor: '#00875a' }}>
                    <div className="value" style={{ color: '#00875a', fontSize: '13px' }}>{triageResult.hospital.type}</div>
                    <div className="label" style={{ marginTop: '3px', fontSize: '11px', color: '#6b778c' }}>{triageResult.hospital.reason}</div>
                  </div>
                </div>
                <div className="triage-assessment-section">
                  <h4>Required Equipment</h4>
                  <div className="triage-equipment-tags">
                    {triageResult.ambulance.equipment.map((eq) => <span key={eq} className="triage-equip-tag">{eq}</span>)}
                  </div>
                </div>
                <div className="triage-assessment-section">
                  <h4>Staff</h4>
                  <div className="triage-equipment-tags">
                    {triageResult.ambulance.staff.map((s) => (
                      <span key={s} className="triage-equip-tag" style={{ background: '#f5f7fa', color: '#172b4d', borderColor: '#e0e0e0' }}>{s}</span>
                    ))}
                  </div>
                </div>
                <div className="triage-assessment-section">
                  <h4>Clinical Reasoning</h4>
                  <ul className="triage-reasoning-list">
                    {triageResult.reasoning.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                </div>
                <div className="triage-assessment-section">
                  <h4>Vital Signs</h4>
                  <div className="triage-assessment-grid">
                    <div className="triage-assessment-item">
                      <div className="label">Breathing</div>
                      <div className="value" style={{ color: triageResult.isBreathing ? '#00875a' : '#de350b' }}>{triageResult.isBreathing ? '✓ Yes' : '✗ No'}</div>
                    </div>
                    <div className="triage-assessment-item">
                      <div className="label">Conscious</div>
                      <div className="value" style={{ color: triageResult.isConscious ? '#00875a' : '#de350b' }}>{triageResult.isConscious ? '✓ Yes' : '✗ No'}</div>
                    </div>
                    <div className="triage-assessment-item">
                      <div className="label">Chest Pain</div>
                      <div className="value" style={{ color: triageResult.hasChestPain ? '#de350b' : '#00875a' }}>{triageResult.hasChestPain ? '✗ Yes' : '✓ No'}</div>
                    </div>
                    <div className="triage-assessment-item">
                      <div className="label">Severe Bleeding</div>
                      <div className="value" style={{ color: triageResult.hasSevereBleeding ? '#de350b' : '#00875a' }}>{triageResult.hasSevereBleeding ? '✗ Yes' : '✓ No'}</div>
                    </div>
                  </div>
                </div>
                <div className="triage-assessment-actions">
                  <button className="triage-restart-btn" onClick={() => { setShowResult(false); handleRestart(); }}>↻ Redo Assessment</button>
                  <button className="triage-result-done-btn" onClick={() => setShowResult(false)}>{t.closeResult}</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
