import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

interface CaseChatMessage {
  id: string;
  senderRole: 'patient' | 'driver';
  senderName: string;
  message: string;
  createdAt: string;
}

interface CaseChatProps {
  bookingId: string;
  dispatchId?: string;
  currentRole: 'patient' | 'driver';
  senderName: string;
  title?: string;
}

const SOCKET_URL = 'http://localhost:3000';

export default function CaseChat({ bookingId, dispatchId, currentRole, senderName, title = 'Chat with Patient' }: CaseChatProps) {
  const [messages, setMessages] = useState<CaseChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const roomKey = useMemo(() => bookingId || dispatchId || '', [bookingId, dispatchId]);

  useEffect(() => {
    if (!roomKey) return;

    const socket = io(SOCKET_URL, { transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('join_case_chat', { bookingId, dispatchId });
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('case_chat_history', (payload: { messages?: CaseChatMessage[] }) => {
      setMessages(payload.messages ?? []);
    });
    socket.on('case_chat_message', (message: CaseChatMessage) => {
      setMessages((prev) => prev.some((item) => item.id === message.id) ? prev : [...prev, message]);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [bookingId, dispatchId, roomKey]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !socketRef.current) return;

    socketRef.current.emit('case_chat_message', {
      bookingId,
      dispatchId,
      senderRole: currentRole,
      senderName,
      message: text,
    });
    setDraft('');
  };

  return (
    <section style={{
      background: 'white',
      border: '1px solid #E0E0E0',
      borderRadius: '12px',
      overflow: 'hidden',
      boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
    }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid #E0E0E0', display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
        <div>
          <div style={{ fontSize: '14px', fontWeight: 700, color: '#172B4D' }}>{title}</div>
          <div style={{ fontSize: '12px', color: connected ? '#00875A' : '#6B778C', marginTop: '2px' }}>
            {connected ? 'Live chat connected' : 'Connecting...'}
          </div>
        </div>
        <div style={{ fontSize: '11px', color: '#6B778C', fontFamily: 'monospace' }}>#{bookingId.slice(0, 8)}</div>
      </div>

      <div style={{ height: '190px', overflowY: 'auto', padding: '12px', background: '#F5F7FA', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {messages.length === 0 ? (
          <div style={{ margin: 'auto', textAlign: 'center', color: '#6B778C', fontSize: '13px', lineHeight: 1.5 }}>
            No messages yet. Send a quick update to start the conversation.
          </div>
        ) : messages.map((item) => {
          const mine = item.senderRole === currentRole;
          return (
            <div key={item.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%' }}>
              <div style={{ fontSize: '11px', color: '#6B778C', margin: mine ? '0 4px 4px 0' : '0 0 4px 4px', textAlign: mine ? 'right' : 'left' }}>
                {mine ? 'You' : item.senderName || item.senderRole}
              </div>
              <div style={{
                padding: '9px 11px',
                borderRadius: '12px',
                borderBottomRightRadius: mine ? '4px' : '12px',
                borderBottomLeftRadius: mine ? '12px' : '4px',
                background: mine ? '#00A3BF' : 'white',
                color: mine ? 'white' : '#172B4D',
                border: mine ? 'none' : '1px solid #E0E0E0',
                fontSize: '13px',
                lineHeight: 1.4,
                wordBreak: 'break-word',
              }}>
                {item.message}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={sendMessage} style={{ display: 'flex', gap: '8px', padding: '10px', borderTop: '1px solid #E0E0E0' }}>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Type a message..."
          maxLength={500}
          style={{ flex: 1, minWidth: 0, border: '1px solid #D9DEE7', borderRadius: '8px', padding: '10px 12px', fontSize: '13px', outline: 'none' }}
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          style={{ border: 'none', borderRadius: '8px', background: draft.trim() ? '#00A3BF' : '#D9DEE7', color: 'white', padding: '0 14px', fontWeight: 700, cursor: draft.trim() ? 'pointer' : 'not-allowed' }}
        >
          Send
        </button>
      </form>
    </section>
  );
}
