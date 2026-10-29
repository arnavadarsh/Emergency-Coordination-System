import { ClipboardEvent, CSSProperties, FormEvent, useEffect, useRef, useState } from 'react';
import { Icon } from '@shared/components/ui/Icon';
import type { ChatMessage, ChatThread, SenderRole, SendStatus } from '../hooks/useCaseChats';
import { ACCEPTED_IMAGE_TYPES, resolveAttachmentUrl } from '../utils/chatImages';
import { formatIstDayLabel, formatIstFull, formatIstTime, sameIstDay } from '@shared/utils/datetime';

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

/** Sent / delivered ticks shown under our own bubbles. */
function StatusTicks({ status }: { status: SendStatus }) {
  if (status === 'sending') return <span className="ui-chat__tick" title="Sending"><Icon name="clock" size={12} label="Sending" /></span>;
  if (status === 'failed') return <span className="ui-chat__tick is-failed" title="Not sent"><Icon name="alertCircle" size={12} label="Not sent" /></span>;
  if (status === 'delivered') return <span className="ui-chat__tick is-delivered" title="Delivered"><Icon name="checkCheck" size={13} label="Delivered" /></span>;
  return <span className="ui-chat__tick" title="Sent"><Icon name="check" size={12} label="Sent" /></span>;
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
  // Only the accent is themeable now; everything else follows the design system.
  const accentStyle = (themeOverrides?.accent ? { '--chat-accent': themeOverrides.accent } : undefined) as CSSProperties | undefined;
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
    <section className="ui-card ui-chat" style={accentStyle} aria-label={title}>
      <header className="ui-chat__header">
        <div className="ui-chat__heading">
          <div className="ui-chat__title">
            <Icon name="messageCircle" size={17} />
            {title}
            {unread > 0 && <span className="ui-count ui-count--danger" aria-label={`${unread} unread`}>{unread}</span>}
          </div>
          <div className={`ui-chat__presence${!connected ? ' is-offline' : peerOnline ? ' is-online' : ' is-away'}`}>
            <span className="ui-chat__presence-dot" aria-hidden="true" />
            {!connected ? 'Reconnecting…' : peerOnline ? `${peerLabel} is online` : `${peerLabel} is offline`}
          </div>
        </div>
        <div className="ui-chat__ref ui-mono">#{bookingId.slice(0, 8)}</div>
      </header>

      <div className="ui-chat__viewport">
        <div ref={scrollRef} onScroll={handleScroll} className="ui-chat__messages" aria-live="polite">
          {messages.length === 0 ? (
            <div className="ui-chat__empty">
              <Icon name="message" size={22} />
              No messages yet. Send a quick update to start the conversation.
            </div>
          ) : messages.map((item, index) => {
            const mine = item.senderRole === currentRole;
            const showDay = index === 0 || !sameIstDay(messages[index - 1].createdAt, item.createdAt);
            return (
              <div key={item.clientId || item.id} style={{ display: 'contents' }}>
                {showDay && <div className="ui-chat__day">{formatIstDayLabel(item.createdAt)}</div>}
                <div className={`ui-chat__msg${mine ? ' is-mine' : ''}`}>
                  <div className="ui-chat__sender">{mine ? 'You' : item.senderName || item.senderRole}</div>
                  <div
                    className={`ui-chat__bubble${item.attachment ? ' has-attachment' : ''}${item.status === 'sending' && !item.attachment ? ' is-sending' : ''}`}
                  >
                    {item.attachment && (
                      <button
                        type="button"
                        className="ui-chat__image"
                        onClick={() => setLightbox({
                          url: resolveAttachmentUrl(apiBaseUrl, item.attachment!.url),
                          name: item.attachment!.name,
                        })}
                        title="Open full size"
                        style={{
                          // Reserve the right box up front so the bubble does not jump on load.
                          aspectRatio: item.attachment.width && item.attachment.height
                            ? `${item.attachment.width} / ${item.attachment.height}`
                            : '4 / 3',
                        }}
                      >
                        <img
                          src={resolveAttachmentUrl(apiBaseUrl, item.attachment.url)}
                          alt={item.attachment.name || 'Shared image'}
                          style={{ opacity: item.uploading ? 0.55 : 1 }}
                        />
                        {item.uploading && <span className="ui-chat__uploading">Uploading…</span>}
                      </button>
                    )}
                    {item.message && <div className="ui-chat__text">{item.message}</div>}
                  </div>
                  <div className="ui-chat__meta">
                    <span title={formatIstFull(item.createdAt)}>{formatIstTime(item.createdAt)}</span>
                    {mine && item.status && <StatusTicks status={item.status} />}
                    {mine && item.status === 'failed' && item.clientId && (
                      <button type="button" className="ui-chat__retry" onClick={() => onRetry(item.clientId!)}>
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
            className="ui-chat__jump"
            onClick={() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); setAtBottom(true); }}
          >
            {unread} new message{unread > 1 ? 's' : ''}
            <Icon name="chevronDown" size={14} />
          </button>
        )}
      </div>

      {(!connected || failedCount > 0) && (
        <div className="ui-chat__warning" role="status">
          <Icon name={!connected ? 'wifiOff' : 'alertCircle'} size={15} />
          {!connected
            ? 'Offline — messages you send will go out as soon as the connection returns.'
            : `${failedCount} message${failedCount > 1 ? 's' : ''} did not send. Tap Retry to try again.`}
        </div>
      )}

      <form onSubmit={submit} className="ui-chat__composer">
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
          className="ui-btn ui-btn--secondary ui-btn--icon"
          onClick={() => fileInputRef.current?.click()}
          title="Send a photo"
          aria-label="Send a photo"
        >
          <Icon name="camera" size={17} />
        </button>
        <input
          className="ui-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onPaste={handlePaste}
          placeholder="Type a message or paste a photo…"
          aria-label="Message"
          maxLength={500}
        />
        <button type="submit" className="ui-btn ui-btn--primary ui-chat__send" disabled={!draft.trim()}>
          <Icon name="send" size={16} />
          <span className="ui-chat__send-label">Send</span>
        </button>
      </form>
      {lightbox && (
        <div onClick={() => setLightbox(null)} role="dialog" aria-label={lightbox.name} className="ui-lightbox">
          <img src={lightbox.url} alt={lightbox.name || 'Shared image'} onClick={event => event.stopPropagation()} />
          <button type="button" className="ui-lightbox__close" onClick={() => setLightbox(null)} aria-label="Close image">
            <Icon name="x" size={20} />
          </button>
        </div>
      )}
    </section>
  );
}
