import { ClipboardEvent, FormEvent, useEffect, useRef, useState } from 'react';
import type { ChatMessage, ChatThread, SenderRole, SendStatus } from '../hooks/useCaseChats';
import { ACCEPTED_IMAGE_TYPES, resolveAttachmentUrl } from '../utils/chatImages';
import { formatIstDayLabel, formatIstFull, formatIstTime, sameIstDay } from '../utils/datetime';

interface CaseChatTheme {
  border: string;
  surface: string;
  bubbleIn: string;
  muted: string;
  accent: string;
  disabled: string;
  shadow: string;
}

interface CaseChatProps {
  bookingId: string;
  currentRole: SenderRole;
  thread?: ChatThread;
  connected: boolean;
  onSend: (text: string) => void;
  onSendImage: (file: File) => void;
  onRetry: (clientId: string) => void;
  /** Used to turn relative attachment URLs into something an <img> can load. */
  apiBaseUrl: string;
  /** Reports whether this chat is genuinely on screen, so unread counting stays honest. */
  onVisibilityChange: (visible: boolean) => void;
  title?: string;
  /** False when the chat is rendered but behind another tab. */
  active?: boolean;
  theme?: Partial<CaseChatTheme>;
}

const DEFAULT_THEME: CaseChatTheme = {
  border: '#E2E8F0',
  surface: '#F8FAFC',
  bubbleIn: '#FFFFFF',
  muted: '#64748B',
  accent: '#00A3BF',
  disabled: '#CBD5E1',
  shadow: '0 2px 8px rgba(15, 23, 42, 0.06)',
};

/** Sent / delivered ticks shown under our own bubbles. */
function StatusTicks({ status, muted }: { status: SendStatus; muted: string }) {
  if (status === 'sending') return <span style={{ color: muted }} title="Sending">◌</span>;
  if (status === 'failed') return <span style={{ color: '#DE350B' }} title="Not sent">!</span>;
  if (status === 'delivered') return <span title="Delivered">✓✓</span>;
  return <span title="Sent">✓</span>;
}

export default function CaseChat({
  bookingId,
  currentRole,
  thread,
  connected,
  onSend,
  onSendImage,
  onRetry,
  onVisibilityChange,
  apiBaseUrl,
  title = 'Chat with Driver',
  active = true,
  theme: themeOverrides,
}: CaseChatProps) {
  const T = { ...DEFAULT_THEME, ...themeOverrides };
  const messages: ChatMessage[] = thread?.messages ?? [];
  const unread = thread?.unread ?? 0;
  const peerOnline = thread?.peerOnline ?? false;
  const peerLabel = currentRole === 'driver' ? 'Patient' : 'Driver';

  const [draft, setDraft] = useState('');
  const [atBottom, setAtBottom] = useState(true);
  const [lightbox, setLightbox] = useState<{ url: string; name: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const inViewRef = useRef(false);

  // ── visibility: on the active tab, scrolled into view, and the page in the foreground ──
  useEffect(() => {
    const report = () => {
      onVisibilityChange(active && inViewRef.current && document.visibilityState === 'visible');
    };

    const node = scrollRef.current;
    const observer = node
      ? new IntersectionObserver(
          entries => {
            inViewRef.current = entries[0]?.isIntersecting ?? false;
            report();
          },
          { threshold: 0.35 },
        )
      : null;
    observer?.observe(node!);
    document.addEventListener('visibilitychange', report);
    report();

    return () => {
      observer?.disconnect();
      document.removeEventListener('visibilitychange', report);
      onVisibilityChange(false);
    };
  }, [active, onVisibilityChange]);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLightbox(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [lightbox]);

  // ── scrolling: follow the conversation only when already at the bottom ──
  useEffect(() => {
    if (atBottom) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, atBottom]);

  const handleScroll = () => {
    const node = scrollRef.current;
    if (!node) return;
    setAtBottom(node.scrollHeight - node.scrollTop - node.clientHeight < 40);
  };

  const pickImages = (files: FileList | null) => {
    if (!files?.length) return;
    Array.from(files).forEach(file => onSendImage(file));
    setAtBottom(true);
  };

  /** Screenshots and copied photos paste straight into the conversation. */
  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const images = Array.from(event.clipboardData?.items ?? [])
      .filter(item => item.kind === 'file' && ACCEPTED_IMAGE_TYPES.includes(item.type))
      .map(item => item.getAsFile())
      .filter((file): file is File => !!file);
    if (images.length === 0) return;
    event.preventDefault();
    images.forEach(file => onSendImage(file));
    setAtBottom(true);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft('');
    setAtBottom(true);
  };

  const failedCount = messages.filter(m => m.status === 'failed').length;

  return (
    <section style={{
      background: 'white',
      border: `1px solid ${T.border}`,
      borderRadius: '12px',
      overflow: 'hidden',
      boxShadow: T.shadow,
    }}>
      <div style={{ padding: '12px 14px', borderBottom: `1px solid ${T.border}`, display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
        <div>
          <div style={{ fontSize: '14px', fontWeight: 700, color: '#172B4D', display: 'flex', alignItems: 'center', gap: '8px' }}>
            {title}
            {unread > 0 && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                minWidth: '18px', height: '18px', padding: '0 5px', borderRadius: '9999px',
                background: '#DE350B', color: 'white', fontSize: '11px', fontWeight: 700,
              }}>
                {unread}
              </span>
            )}
          </div>
          <div style={{ fontSize: '12px', color: connected ? '#00875A' : T.muted, marginTop: '2px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{
              width: '7px', height: '7px', borderRadius: '50%',
              background: connected ? (peerOnline ? '#00875A' : '#FFAB00') : '#97A0AF',
            }} />
            {!connected ? 'Reconnecting…' : peerOnline ? `${peerLabel} is online` : `${peerLabel} is offline`}
          </div>
        </div>
        <div style={{ fontSize: '11px', color: T.muted, fontFamily: 'monospace' }}>#{bookingId.slice(0, 8)}</div>
      </div>

      <div style={{ position: 'relative' }}>
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          style={{ height: '200px', overflowY: 'auto', padding: '12px', background: T.surface, display: 'flex', flexDirection: 'column', gap: '10px' }}
        >
          {messages.length === 0 ? (
            <div style={{ margin: 'auto', textAlign: 'center', color: T.muted, fontSize: '13px', lineHeight: 1.5 }}>
              No messages yet. Send a quick update to start the conversation.
            </div>
          ) : messages.map((item, index) => {
            const mine = item.senderRole === currentRole;
            const showDay = index === 0 || !sameIstDay(messages[index - 1].createdAt, item.createdAt);
            return (
              <div key={item.clientId || item.id} style={{ display: 'contents' }}>
                {showDay && (
                  <div style={{ alignSelf: 'center', fontSize: '11px', color: T.muted, background: T.bubbleIn, border: `1px solid ${T.border}`, borderRadius: '9999px', padding: '2px 10px' }}>
                    {formatIstDayLabel(item.createdAt)}
                  </div>
                )}
                <div style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%' }}>
                  <div style={{ fontSize: '11px', color: T.muted, margin: mine ? '0 4px 4px 0' : '0 0 4px 4px', textAlign: mine ? 'right' : 'left' }}>
                    {mine ? 'You' : item.senderName || item.senderRole}
                  </div>
                  <div style={{
                    padding: item.attachment ? '4px' : '9px 11px',
                    borderRadius: '12px',
                    borderBottomRightRadius: mine ? '4px' : '12px',
                    borderBottomLeftRadius: mine ? '12px' : '4px',
                    background: mine ? T.accent : T.bubbleIn,
                    color: mine ? 'white' : '#172B4D',
                    border: mine ? 'none' : `1px solid ${T.border}`,
                    opacity: item.status === 'sending' && !item.attachment ? 0.75 : 1,
                    fontSize: '13px',
                    lineHeight: 1.4,
                    wordBreak: 'break-word',
                  }}>
                    {item.attachment && (
                      <button
                        type="button"
                        onClick={() => setLightbox({
                          url: resolveAttachmentUrl(apiBaseUrl, item.attachment!.url),
                          name: item.attachment!.name,
                        })}
                        title="Open full size"
                        style={{
                          display: 'block', position: 'relative', padding: 0, border: 'none',
                          background: 'transparent', cursor: 'zoom-in', borderRadius: '9px',
                          overflow: 'hidden', width: '220px', maxWidth: '100%',
                          // Reserve the right box up front so the bubble does not jump on load.
                          aspectRatio: item.attachment.width && item.attachment.height
                            ? `${item.attachment.width} / ${item.attachment.height}`
                            : '4 / 3',
                        }}
                      >
                        <img
                          src={resolveAttachmentUrl(apiBaseUrl, item.attachment.url)}
                          alt={item.attachment.name || 'Shared image'}
                          style={{
                            width: '100%', height: '100%', objectFit: 'cover', display: 'block',
                            opacity: item.uploading ? 0.55 : 1,
                          }}
                        />
                        {item.uploading && (
                          <span style={{
                            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
                            justifyContent: 'center', background: 'rgba(15,23,42,0.35)',
                            color: 'white', fontSize: '12px', fontWeight: 700,
                          }}>
                            Uploading…
                          </span>
                        )}
                      </button>
                    )}
                    {item.message && (
                      <div style={{ padding: item.attachment ? '6px 7px 3px' : 0 }}>{item.message}</div>
                    )}
                  </div>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '5px',
                    justifyContent: mine ? 'flex-end' : 'flex-start',
                    fontSize: '10px', color: T.muted, margin: mine ? '3px 4px 0 0' : '3px 0 0 4px',
                  }}>
                    <span title={formatIstFull(item.createdAt)}>{formatIstTime(item.createdAt)}</span>
                    {mine && item.status && <StatusTicks status={item.status} muted={T.muted} />}
                    {mine && item.status === 'failed' && item.clientId && (
                      <button
                        type="button"
                        onClick={() => onRetry(item.clientId!)}
                        style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', color: '#DE350B', fontSize: '10px', fontWeight: 700, textDecoration: 'underline' }}
                      >
                        Retry
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        {!atBottom && unread > 0 && (
          <button
            type="button"
            onClick={() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); setAtBottom(true); }}
            style={{
              position: 'absolute', left: '50%', bottom: '10px', transform: 'translateX(-50%)',
              border: 'none', borderRadius: '9999px', padding: '6px 14px', cursor: 'pointer',
              background: T.accent, color: 'white', fontSize: '12px', fontWeight: 700,
              boxShadow: '0 2px 8px rgba(15,23,42,0.2)',
            }}
          >
            {unread} new message{unread > 1 ? 's' : ''} ↓
          </button>
        )}
      </div>

      {(!connected || failedCount > 0) && (
        <div style={{ padding: '7px 12px', background: '#FFF4E5', borderTop: `1px solid ${T.border}`, color: '#B45309', fontSize: '12px' }}>
          {!connected
            ? 'Offline — messages you send will go out as soon as the connection returns.'
            : `${failedCount} message${failedCount > 1 ? 's' : ''} did not send. Tap Retry to try again.`}
        </div>
      )}

      <form onSubmit={submit} style={{ display: 'flex', gap: '8px', padding: '10px', borderTop: `1px solid ${T.border}` }}>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES.join(',')}
          multiple
          onChange={event => { pickImages(event.target.files); event.target.value = ''; }}
          style={{ display: 'none' }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          title="Send a photo"
          aria-label="Send a photo"
          style={{
            border: `1px solid ${T.disabled}`, borderRadius: '8px', background: 'white',
            color: T.muted, padding: '0 12px', fontSize: '16px', cursor: 'pointer', lineHeight: 1,
          }}
        >
          📷
        </button>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onPaste={handlePaste}
          placeholder="Type a message or paste a photo..."
          maxLength={500}
          style={{ flex: 1, minWidth: 0, border: `1px solid ${T.disabled}`, borderRadius: '8px', padding: '10px 12px', fontSize: '13px', outline: 'none' }}
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          style={{ border: 'none', borderRadius: '8px', background: draft.trim() ? T.accent : T.disabled, color: 'white', padding: '0 14px', fontWeight: 700, cursor: draft.trim() ? 'pointer' : 'not-allowed' }}
        >
          Send
        </button>
      </form>
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          role="dialog"
          aria-label={lightbox.name}
          style={{
            position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(15,23,42,0.88)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', cursor: 'zoom-out',
          }}
        >
          <img
            src={lightbox.url}
            alt={lightbox.name || 'Shared image'}
            onClick={event => event.stopPropagation()}
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: '8px', cursor: 'default' }}
          />
          <button
            type="button"
            onClick={() => setLightbox(null)}
            aria-label="Close image"
            style={{
              position: 'absolute', top: '18px', right: '22px', width: '40px', height: '40px',
              borderRadius: '50%', border: 'none', cursor: 'pointer', fontSize: '22px',
              background: 'rgba(255,255,255,0.16)', color: 'white',
            }}
          >
            ×
          </button>
        </div>
      )}
    </section>
  );
}
