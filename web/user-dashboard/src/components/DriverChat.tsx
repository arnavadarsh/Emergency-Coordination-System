import { useEffect, useRef, useState, useCallback } from 'react';
import axios from 'axios';
import { io, type Socket } from 'socket.io-client';
import { tokenStorage } from '../utils/tokenStorage';
import '../styles/DriverChat.css';

const API_BASE_URL = 'http://localhost:3000/api';
const SOCKET_URL = 'http://localhost:3000';

interface ChatMessage {
  id: string;
  bookingId: string;
  senderRole: 'USER' | 'DRIVER' | 'SYSTEM' | string;
  senderId: string;
  senderName?: string | null;
  text: string;
  mediaType?: 'image' | 'audio' | null;
  mediaData?: string | null;
  readAt?: string | null;
  createdAt: string;
}

interface DriverChatProps {
  bookingId: string;
  selfRole?: 'USER' | 'DRIVER';
  title?: string;
  peerLabel?: string;
  /** Phone number of the other party, for one-tap calling. */
  peerPhone?: string;
  /** When true the chat is read-only (trip ended). */
  locked?: boolean;
}

// One-tap canned messages per role.
const QUICK_REPLIES: Record<'USER' | 'DRIVER', string[]> = {
  DRIVER: ['On my way 🚑', 'Arriving in 2 min', 'Please unlock the gate', 'Move patient to the entrance', 'Stuck in traffic, hang on'],
  USER: ['Door is open', "We're outside", 'Patient is upstairs', 'Please hurry 🙏', 'Calling you now'],
};

const TRANSLATE_LANGS: { code: string; label: string }[] = [
  { code: 'English', label: 'EN' },
  { code: 'Hindi', label: 'हि' },
  { code: 'Spanish', label: 'ES' },
  { code: 'French', label: 'FR' },
];

// Short notification beep, generated so no audio asset is needed.
function playBeep() {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = 'sine'; o.frequency.value = 880;
    g.gain.setValueAtTime(0.001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    o.start(); o.stop(ctx.currentTime + 0.32);
    o.onended = () => ctx.close();
  } catch { /* ignore */ }
}

/** Downscale an image File to a JPEG data URL (caps payload size). */
function fileToScaledDataUrl(file: File, maxDim = 1280, quality = 0.7): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const s = Math.min(maxDim / width, maxDim / height);
          width = Math.round(width * s); height = Math.round(height * s);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('no ctx'));
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = reader.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

/**
 * Booking-scoped chat between the patient and the assigned ambulance driver.
 * Features: quick replies, read receipts, typing indicator, unread + sound/
 * desktop notifications, voice notes, photos, one-tap call, per-message
 * translation, report, and a locked (read-only) state when the trip ends.
 */
export default function DriverChat({
  bookingId,
  selfRole = 'USER',
  title = 'Chat with your driver',
  peerLabel = 'Driver',
  peerPhone,
  locked = false,
}: DriverChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [connected, setConnected] = useState(false);
  const [peerTyping, setPeerTyping] = useState(false);
  const [unread, setUnread] = useState(0);
  const [recording, setRecording] = useState(false);
  const [showQuick, setShowQuick] = useState(true);
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [showOriginal, setShowOriginal] = useState<Record<string, boolean>>({});
  const [targetLang, setTargetLang] = useState('Hindi');

  const endRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const lastTypingSentRef = useRef(0);
  const peerTypingTimeoutRef = useRef<any>(null);

  const authHeader = useCallback(
    () => ({ headers: { Authorization: `Bearer ${tokenStorage.getToken()}` } }),
    [],
  );

  const isAtBottom = () => {
    const el = bodyRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  const upsert = useCallback((msg: ChatMessage) => {
    setMessages((prev) => {
      const i = prev.findIndex((m) => m.id === msg.id);
      if (i >= 0) { const next = [...prev]; next[i] = { ...next[i], ...msg }; return next; }
      return [...prev, msg];
    });
  }, []);

  const markRead = useCallback(async () => {
    try { await axios.post(`${API_BASE_URL}/chat/${bookingId}/read`, {}, authHeader()); } catch { /* */ }
    setUnread(0);
  }, [bookingId, authHeader]);

  // Load history + open the realtime channel.
  useEffect(() => {
    if (!bookingId) return;
    let cancelled = false;
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }

    (async () => {
      try {
        const { data } = await axios.get(`${API_BASE_URL}/chat/${bookingId}/messages`, authHeader());
        if (!cancelled && Array.isArray(data)) {
          setMessages(data);
          markRead();
        }
      } catch { /* best-effort */ }
    })();

    const socket = io(SOCKET_URL, { transports: ['websocket'] });
    socketRef.current = socket;
    socket.on('connect', () => { setConnected(true); socket.emit('chat:join', { bookingId }); });
    socket.on('disconnect', () => setConnected(false));

    socket.on('chat:message', (msg: ChatMessage) => {
      if (msg?.bookingId !== bookingId) return;
      const incoming = msg.senderRole !== selfRole;
      const atBottom = isAtBottom();
      upsert(msg);
      if (incoming) {
        if (document.hidden || !atBottom) {
          setUnread((u) => u + 1);
          playBeep();
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
            try {
              new Notification(msg.senderName || peerLabel, {
                body: msg.mediaType ? (msg.mediaType === 'image' ? '📷 Photo' : '🎤 Voice note') : msg.text,
              });
            } catch { /* */ }
          }
        } else {
          markRead();
        }
      }
    });

    socket.on('chat:read', (p: { ids: string[]; readerRole: string; readAt: string }) => {
      if (p.readerRole === selfRole) return; // the other side read my messages
      setMessages((prev) => prev.map((m) => (p.ids.includes(m.id) ? { ...m, readAt: p.readAt } : m)));
    });

    socket.on('chat:typing', (p: { role: string }) => {
      if (p.role === selfRole) return;
      setPeerTyping(true);
      clearTimeout(peerTypingTimeoutRef.current);
      peerTypingTimeoutRef.current = setTimeout(() => setPeerTyping(false), 2500);
    });

    return () => {
      cancelled = true;
      socket.emit('chat:leave', { bookingId });
      socket.off('chat:message'); socket.off('chat:read'); socket.off('chat:typing');
      socket.disconnect();
      socketRef.current = null;
    };
  }, [bookingId, selfRole, peerLabel, upsert, markRead, authHeader]);

  useEffect(() => {
    if (isAtBottom()) endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, peerTyping]);

  // Mark read when the tab regains focus.
  useEffect(() => {
    const onVis = () => { if (!document.hidden) markRead(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [markRead]);

  const emitTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingSentRef.current > 1200) {
      lastTypingSentRef.current = now;
      socketRef.current?.emit('chat:typing', { bookingId, role: selfRole });
    }
  }, [bookingId, selfRole]);

  const postMessage = useCallback(
    async (payload: { text?: string; mediaType?: 'image' | 'audio'; mediaData?: string }) => {
      if (locked) return;
      setSending(true);
      try {
        const { data } = await axios.post(`${API_BASE_URL}/chat/${bookingId}/messages`, payload, authHeader());
        if (data?.id) upsert(data);
      } catch { /* keep input on failure */ throw new Error('send failed'); }
      finally { setSending(false); }
    },
    [bookingId, authHeader, upsert, locked],
  );

  const sendText = useCallback(async (text: string) => {
    const t = text.trim();
    if (!t || sending) return;
    try { await postMessage({ text: t }); setInput(''); } catch { /* */ }
  }, [postMessage, sending]);

  const onPickImage = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const dataUrl = await fileToScaledDataUrl(file);
      await postMessage({ mediaType: 'image', mediaData: dataUrl });
    } catch { /* */ }
  }, [postMessage]);

  const toggleRecording = useCallback(async () => {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      recorderRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (ev) => { if (ev.data.size) chunksRef.current.push(ev.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        if (blob.size > 0) {
          try { await postMessage({ mediaType: 'audio', mediaData: await blobToDataUrl(blob) }); } catch { /* */ }
        }
      };
      rec.start();
      setRecording(true);
    } catch { setRecording(false); }
  }, [recording, postMessage]);

  const translate = useCallback(async (m: ChatMessage) => {
    if (showOriginal[m.id]) { setShowOriginal((s) => ({ ...s, [m.id]: false })); return; }
    if (translations[m.id]) { setShowOriginal((s) => ({ ...s, [m.id]: false })); return; }
    try {
      const { data } = await axios.post(`${API_BASE_URL}/chat/message/${m.id}/translate`, { lang: targetLang }, authHeader());
      if (data?.text) setTranslations((t) => ({ ...t, [m.id]: data.text }));
    } catch { /* */ }
  }, [translations, showOriginal, targetLang, authHeader]);

  const report = useCallback(async () => {
    const reason = window.prompt('Report this conversation. What is the issue? (optional)') ?? undefined;
    try {
      await axios.post(`${API_BASE_URL}/chat/${bookingId}/report`, { reason }, authHeader());
      alert('Thanks — this conversation has been reported.');
    } catch { alert('Could not submit the report.'); }
  }, [bookingId, authHeader]);

  return (
    <div className="driver-chat">
      <div className="driver-chat-header">
        <span className="driver-chat-title">💬 {title}</span>
        <div className="driver-chat-headtools">
          <select className="driver-chat-lang" value={targetLang} onChange={(e) => setTargetLang(e.target.value)} title="Translate to">
            {TRANSLATE_LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
          {peerPhone && <a className="driver-chat-call" href={`tel:${peerPhone}`} title={`Call ${peerLabel}`}>📞</a>}
          <button className="driver-chat-report" onClick={report} title="Report">⚠</button>
          <span className={`driver-chat-dot ${connected ? 'on' : 'off'}`} title={connected ? 'Live' : 'Connecting…'} />
        </div>
      </div>

      {unread > 0 && (
        <button className="driver-chat-unread" onClick={() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); markRead(); }}>
          {unread} new message{unread > 1 ? 's' : ''} ↓
        </button>
      )}

      <div className="driver-chat-body" ref={bodyRef}>
        {messages.length === 0 ? (
          <div className="driver-chat-empty">No messages yet. Say hello to your {peerLabel.toLowerCase()}.</div>
        ) : (
          messages.map((m) => {
            if (m.senderRole === 'SYSTEM') {
              return <div key={m.id} className="driver-chat-system">{m.text}</div>;
            }
            const mine = m.senderRole === selfRole;
            const shownText = translations[m.id] && !showOriginal[m.id] ? translations[m.id] : m.text;
            return (
              <div key={m.id} className={`driver-chat-row ${mine ? 'mine' : 'theirs'}`}>
                <div className="driver-chat-bubble">
                  {!mine && <div className="driver-chat-sender">{m.senderName || peerLabel}</div>}
                  {m.mediaType === 'image' && m.mediaData && (
                    <a href={m.mediaData} target="_blank" rel="noopener noreferrer">
                      <img className="driver-chat-img" src={m.mediaData} alt="attachment" />
                    </a>
                  )}
                  {m.mediaType === 'audio' && m.mediaData && (
                    <audio className="driver-chat-audio" controls src={m.mediaData} />
                  )}
                  {shownText && <div className="driver-chat-text">{shownText}</div>}
                  <div className="driver-chat-meta">
                    {m.text && (
                      <button className="driver-chat-translate" onClick={() => translate(m)}>
                        {translations[m.id] ? (showOriginal[m.id] ? 'Translate' : 'Original') : 'Translate'}
                      </button>
                    )}
                    <span className="driver-chat-time">
                      {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {mine && <span className={`driver-chat-tick ${m.readAt ? 'read' : ''}`}>{m.readAt ? '✓✓' : '✓'}</span>}
                  </div>
                </div>
              </div>
            );
          })
        )}
        {peerTyping && (
          <div className="driver-chat-row theirs">
            <div className="driver-chat-bubble driver-chat-typing"><span></span><span></span><span></span></div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {locked ? (
        <div className="driver-chat-locked">🔒 This chat is closed — the trip has ended.</div>
      ) : (
        <>
          {showQuick && (
            <div className="driver-chat-quick">
              {QUICK_REPLIES[selfRole].map((q) => (
                <button key={q} onClick={() => sendText(q)} disabled={sending}>{q}</button>
              ))}
            </div>
          )}
          <div className="driver-chat-input">
            <button className="driver-chat-iconbtn" onClick={() => setShowQuick((s) => !s)} title="Quick replies">⚡</button>
            <label className="driver-chat-iconbtn" title="Send photo">
              📷
              <input type="file" accept="image/*" hidden onChange={onPickImage} />
            </label>
            <button
              className={`driver-chat-iconbtn ${recording ? 'rec' : ''}`}
              onClick={toggleRecording}
              title={recording ? 'Stop recording' : 'Record voice note'}
            >
              {recording ? '⏹' : '🎤'}
            </button>
            <input
              type="text"
              value={input}
              placeholder={recording ? 'Recording…' : `Message your ${peerLabel.toLowerCase()}…`}
              disabled={recording}
              onChange={(e) => { setInput(e.target.value); emitTyping(); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); sendText(input); } }}
            />
            <button className="driver-chat-send" onClick={() => sendText(input)} disabled={!input.trim() || sending} aria-label="Send">➤</button>
          </div>
        </>
      )}
    </div>
  );
}
