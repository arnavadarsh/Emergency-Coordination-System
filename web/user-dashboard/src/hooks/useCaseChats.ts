import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import toast from 'react-hot-toast';
import {
  prepareImageForUpload,
  uploadChatImage,
  type ChatAttachment,
  type PreparedImage,
} from '../utils/chatImages';
import { SOCKET_URL } from '../config/api';

export type SenderRole = 'patient' | 'driver';

/** Lifecycle of a message we sent ourselves. Received messages carry no status. */
export type SendStatus = 'sending' | 'sent' | 'delivered' | 'failed';

export interface ChatMessage {
  /** Server id once saved; until then the optimistic clientId. */
  id: string;
  clientId?: string;
  roomId?: string;
  senderRole: SenderRole;
  senderName: string;
  message: string;
  createdAt: string;
  status?: SendStatus;
  attachment?: ChatAttachment | null;
  /** True while the image is still being uploaded, so the bubble can show progress. */
  uploading?: boolean;
}

export interface ChatThread {
  messages: ChatMessage[];
  unread: number;
  peerOnline: boolean;
}

export interface CaseChatRoom {
  bookingId: string;
  dispatchId?: string;
}

export interface CaseChatApi {
  connected: boolean;
  threads: Record<string, ChatThread>;
  totalUnread: number;
  send: (roomId: string, text: string) => void;
  sendImage: (roomId: string, file: File) => Promise<void>;
  retry: (roomId: string, clientId: string) => void;
  /** Tell the hook whether a room's chat is currently on screen, which drives unread counting. */
  setRoomVisible: (roomId: string, visible: boolean) => void;
}


/** How long to wait for the server to confirm a send before marking it failed. */
const ACK_TIMEOUT_MS = 10000;
/**
 * Only auto-resend on reconnect while the message is still worth saying. A three-minute-old
 * "I'm outside" arriving after a long outage is worse than not arriving at all.
 */
const AUTO_RETRY_MAX_AGE_MS = 120000;

const EMPTY_THREAD: ChatThread = { messages: [], unread: 0, peerOnline: false };

const newClientId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;

/** Short two-tone chime via WebAudio — avoids shipping an audio asset. */
const playChime = () => {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const tone = (freq: number, at: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.18);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + 0.2);
    };
    tone(880, 0);
    tone(1180, 0.12);
    setTimeout(() => ctx.close().catch(() => {}), 600);
  } catch {
    /* audio is a nicety — never let it break the chat */
  }
};

/**
 * Owns a single socket for every case chat the dashboard cares about.
 *
 * Lives at dashboard level rather than inside the chat component on purpose: the tab
 * switchers unmount the chat UI, and a connection that dies with it could never raise
 * an unread badge for the tab you are not looking at.
 */
export function useCaseChats({
  rooms,
  role,
  senderName,
  apiBaseUrl,
  getToken,
}: {
  rooms: CaseChatRoom[];
  role: SenderRole;
  senderName: string;
  apiBaseUrl: string;
  getToken: () => string | null;
}): CaseChatApi {
  const [connected, setConnected] = useState(false);
  const [threads, setThreads] = useState<Record<string, ChatThread>>({});

  const socketRef = useRef<Socket | null>(null);
  /** Latest identity, read at emit time so a late-loading profile never resets the socket. */
  const identityRef = useRef({ role, senderName });
  const roomsRef = useRef<CaseChatRoom[]>(rooms);
  const joinedRef = useRef(new Set<string>());
  const visibleRef = useRef(new Set<string>());
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  /** Messages sent but not yet confirmed, kept for replay on reconnect. */
  const pendingRef = useRef(new Map<string, { roomId: string; message: ChatMessage }>());
  /** Prepared images awaiting (or retrying) upload, keyed by clientId. */
  const pendingImagesRef = useRef(new Map<string, PreparedImage>());
  const uploadCtxRef = useRef({ apiBaseUrl, getToken });
  uploadCtxRef.current = { apiBaseUrl, getToken };

  identityRef.current = { role, senderName };
  roomsRef.current = rooms;

  const roomsKey = useMemo(
    () => rooms.map(r => `${r.bookingId}:${r.dispatchId ?? ''}`).sort().join('|'),
    [rooms],
  );

  const patchThread = useCallback((roomId: string, patch: (thread: ChatThread) => ChatThread) => {
    setThreads(prev => ({ ...prev, [roomId]: patch(prev[roomId] ?? EMPTY_THREAD) }));
  }, []);

  /** Free an optimistic preview's object URL once the server copy has arrived. */
  const releasePreview = useCallback((clientId: string) => {
    const prepared = pendingImagesRef.current.get(clientId);
    if (prepared) {
      URL.revokeObjectURL(prepared.previewUrl);
      pendingImagesRef.current.delete(clientId);
    }
  }, []);

  const clearTimer = (clientId: string) => {
    const timer = timersRef.current.get(clientId);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(clientId);
    }
  };

  const markStatus = useCallback((roomId: string, clientId: string, status: SendStatus) => {
    patchThread(roomId, thread => ({
      ...thread,
      messages: thread.messages.map(m => (m.clientId === clientId ? { ...m, status } : m)),
    }));
  }, [patchThread]);

  /** Mark an unconfirmed message failed once the ack window closes. */
  const armTimeout = useCallback((roomId: string, clientId: string) => {
    clearTimer(clientId);
    timersRef.current.set(
      clientId,
      setTimeout(() => {
        timersRef.current.delete(clientId);
        setThreads(prev => {
          const thread = prev[roomId];
          if (!thread) return prev;
          return {
            ...prev,
            [roomId]: {
              ...thread,
              messages: thread.messages.map(m =>
                m.clientId === clientId && m.status === 'sending' ? { ...m, status: 'failed' } : m,
              ),
            },
          };
        });
      }, ACK_TIMEOUT_MS),
    );
  }, []);

  const emit = useCallback((roomId: string, message: ChatMessage) => {
    const socket = socketRef.current;
    const room = roomsRef.current.find(r => r.bookingId === roomId);
    if (!socket?.connected || !message.clientId) return false;
    socket.emit('case_chat_message', {
      bookingId: roomId,
      dispatchId: room?.dispatchId,
      senderRole: identityRef.current.role,
      senderName: identityRef.current.senderName,
      message: message.message,
      clientId: message.clientId,
      attachment: message.attachment ?? undefined,
    });
    armTimeout(roomId, message.clientId);
    return true;
  }, [armTimeout]);

  // ── one socket, created once and kept alive across tab switches ──
  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      joinedRef.current.clear();
      roomsRef.current.forEach(room => {
        socket.emit('join_case_chat', {
          bookingId: room.bookingId,
          dispatchId: room.dispatchId,
          role: identityRef.current.role,
        });
        joinedRef.current.add(room.bookingId);
      });

      // Replay anything still unconfirmed, while it is still recent enough to matter.
      const now = Date.now();
      pendingRef.current.forEach(({ roomId, message }) => {
        // Images still uploading are driven by their own upload promise, not the socket queue.
        if (message.uploading) return;
        const age = now - new Date(message.createdAt).getTime();
        if (age > AUTO_RETRY_MAX_AGE_MS) {
          if (message.clientId) markStatus(roomId, message.clientId, 'failed');
          return;
        }
        if (message.clientId) markStatus(roomId, message.clientId, 'sending');
        emit(roomId, message);
      });
    });

    socket.on('disconnect', () => {
      setConnected(false);
      joinedRef.current.clear();
      timersRef.current.forEach(clearTimeout);
      timersRef.current.clear();
      setThreads(prev => {
        const next: Record<string, ChatThread> = {};
        for (const [roomId, thread] of Object.entries(prev)) next[roomId] = { ...thread, peerOnline: false };
        return next;
      });
    });

    socket.on('case_chat_history', (payload: { roomId?: string; messages?: ChatMessage[] }) => {
      const roomId = payload?.roomId;
      if (!roomId) return;
      const history = (payload.messages ?? []).map(m => ({
        ...m,
        status: m.senderRole === identityRef.current.role ? ('sent' as SendStatus) : undefined,
      }));
      patchThread(roomId, thread => ({
        ...thread,
        // Keep locally pending messages the server has not stored yet.
        messages: [...history, ...thread.messages.filter(m => m.status === 'sending' || m.status === 'failed')],
      }));
    });

    socket.on('case_chat_presence', (payload: { roomId?: string; patientOnline: boolean; driverOnline: boolean }) => {
      const roomId = payload?.roomId;
      if (!roomId) return;
      const peerOnline = identityRef.current.role === 'driver' ? payload.patientOnline : payload.driverOnline;
      patchThread(roomId, thread => ({
        ...thread,
        peerOnline,
        // Peer just joined — everything we already sent has now reached them.
        messages: peerOnline
          ? thread.messages.map(m => (m.status === 'sent' ? { ...m, status: 'delivered' as SendStatus } : m))
          : thread.messages,
      }));
    });

    socket.on('case_chat_message', (incoming: ChatMessage & { clientId?: string | null }) => {
      const roomId = incoming?.roomId;
      if (!roomId) return;

      patchThread(roomId, thread => {
        if (thread.messages.some(m => m.id === incoming.id)) return thread;

        // Our own message returning on the room broadcast — settle the optimistic bubble.
        if (incoming.clientId) {
          const idx = thread.messages.findIndex(m => m.clientId === incoming.clientId);
          if (idx !== -1) {
            clearTimer(incoming.clientId);
            pendingRef.current.delete(incoming.clientId);
            releasePreview(incoming.clientId);
            const messages = [...thread.messages];
            messages[idx] = {
              ...incoming,
              status: messages[idx].status === 'delivered' ? 'delivered' : 'sent',
            };
            return { ...thread, messages };
          }
        }

        const fromPeer = incoming.senderRole !== identityRef.current.role;
        const unseen = fromPeer && !(visibleRef.current.has(roomId) && document.visibilityState === 'visible');
        if (unseen) {
          playChime();
          toast(`${incoming.senderName || incoming.senderRole}: ${incoming.message}`, { icon: '💬' });
        }
        return {
          ...thread,
          messages: [...thread.messages, incoming],
          unread: unseen ? thread.unread + 1 : thread.unread,
        };
      });
    });

    socket.on(
      'case_chat_message_ack',
      (payload: ChatMessage & { clientId?: string | null; peerOnline?: boolean }) => {
        const roomId = payload?.roomId;
        if (!roomId || !payload?.clientId) return;
        clearTimer(payload.clientId);
        pendingRef.current.delete(payload.clientId);
        patchThread(roomId, thread => ({
          ...thread,
          messages: thread.messages.map(m =>
            m.clientId === payload.clientId
              ? {
                  ...m,
                  id: payload.id,
                  createdAt: payload.createdAt,
                  status: payload.peerOnline ? 'delivered' : 'sent',
                }
              : m,
          ),
        }));
      },
    );

    socket.on('case_chat_error', (payload: { message?: string }) => {
      toast.error(payload?.message || 'Chat error');
    });

    return () => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current.clear();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [emit, markStatus, patchThread]);

  // Join rooms as bookings appear (and on the first render after connect).
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket?.connected) return;
    rooms.forEach(room => {
      if (joinedRef.current.has(room.bookingId)) return;
      socket.emit('join_case_chat', {
        bookingId: room.bookingId,
        dispatchId: room.dispatchId,
        role: identityRef.current.role,
      });
      joinedRef.current.add(room.bookingId);
    });
  }, [roomsKey, connected, rooms]);

  const setRoomVisible = useCallback((roomId: string, visible: boolean) => {
    if (visible) {
      visibleRef.current.add(roomId);
      setThreads(prev => {
        const thread = prev[roomId];
        if (!thread || thread.unread === 0) return prev;
        return { ...prev, [roomId]: { ...thread, unread: 0 } };
      });
    } else {
      visibleRef.current.delete(roomId);
    }
  }, []);

  const send = useCallback((roomId: string, text: string) => {
    const body = text.trim();
    if (!body) return;
    const clientId = newClientId();
    const optimistic: ChatMessage = {
      id: clientId,
      clientId,
      roomId,
      senderRole: identityRef.current.role,
      senderName: identityRef.current.senderName,
      message: body,
      createdAt: new Date().toISOString(),
      status: 'sending',
    };
    pendingRef.current.set(clientId, { roomId, message: optimistic });
    patchThread(roomId, thread => ({ ...thread, messages: [...thread.messages, optimistic] }));
    emit(roomId, optimistic); // if offline, the reconnect handler replays it
  }, [emit, patchThread]);

  /**
   * Upload first, then send the message referencing the stored URL. The bubble appears
   * immediately with a local preview so the sender sees something happen straight away.
   */
  const sendImage = useCallback(async (roomId: string, file: File) => {
    let prepared: PreparedImage;
    try {
      prepared = await prepareImageForUpload(file);
    } catch (error: any) {
      toast.error(error?.message || 'Could not read that image');
      return;
    }

    const clientId = newClientId();
    pendingImagesRef.current.set(clientId, prepared);

    const optimistic: ChatMessage = {
      id: clientId,
      clientId,
      roomId,
      senderRole: identityRef.current.role,
      senderName: identityRef.current.senderName,
      message: '',
      createdAt: new Date().toISOString(),
      status: 'sending',
      uploading: true,
      attachment: {
        url: prepared.previewUrl,
        type: prepared.blob.type,
        name: prepared.name,
        size: prepared.blob.size,
        width: prepared.width,
        height: prepared.height,
      },
    };
    patchThread(roomId, thread => ({ ...thread, messages: [...thread.messages, optimistic] }));

    await uploadAndSend(roomId, clientId, prepared);
  }, [patchThread]);

  /** Shared by first send and retry: push the bytes, then emit the message. */
  const uploadAndSend = useCallback(async (roomId: string, clientId: string, prepared: PreparedImage) => {
    try {
      const { apiBaseUrl, getToken } = uploadCtxRef.current;
      const attachment = await uploadChatImage(apiBaseUrl, getToken(), prepared);

      const ready: ChatMessage = {
        id: clientId,
        clientId,
        roomId,
        senderRole: identityRef.current.role,
        senderName: identityRef.current.senderName,
        message: '',
        createdAt: new Date().toISOString(),
        status: 'sending',
        // Keep showing the local preview until the server copy arrives — it is already decoded.
        attachment: { ...attachment, url: prepared.previewUrl },
      };
      // The stored URL is what actually goes on the wire.
      const wire = { ...ready, attachment };
      pendingRef.current.set(clientId, { roomId, message: wire });

      patchThread(roomId, thread => ({
        ...thread,
        messages: thread.messages.map(m => (m.clientId === clientId ? { ...ready, uploading: false } : m)),
      }));

      emit(roomId, wire); // if offline, the reconnect handler replays it
    } catch (error: any) {
      toast.error(error?.message || 'Image failed to send');
      patchThread(roomId, thread => ({
        ...thread,
        messages: thread.messages.map(m =>
          m.clientId === clientId ? { ...m, status: 'failed' as SendStatus, uploading: false } : m,
        ),
      }));
    }
  }, [emit, patchThread]);

  const retry = useCallback((roomId: string, clientId: string) => {
    // An image that never reached the server has to be uploaded again first.
    const prepared = pendingImagesRef.current.get(clientId);
    if (prepared) {
      patchThread(roomId, thread => ({
        ...thread,
        messages: thread.messages.map(m =>
          m.clientId === clientId ? { ...m, status: 'sending' as SendStatus, uploading: true } : m,
        ),
      }));
      void uploadAndSend(roomId, clientId, prepared);
      return;
    }

    setThreads(prev => {
      const thread = prev[roomId];
      const message = thread?.messages.find(m => m.clientId === clientId);
      if (!message) return prev;
      const retried = { ...message, createdAt: new Date().toISOString(), status: 'sending' as SendStatus };
      pendingRef.current.set(clientId, { roomId, message: retried });
      queueMicrotask(() => {
        if (!emit(roomId, retried)) {
          toast.error('Still offline — this will send when the connection returns.');
        }
      });
      return {
        ...prev,
        [roomId]: {
          ...thread,
          messages: thread.messages.map(m => (m.clientId === clientId ? retried : m)),
        },
      };
    });
  }, [emit, patchThread, uploadAndSend]);

  const totalUnread = useMemo(
    () => Object.values(threads).reduce((sum, thread) => sum + thread.unread, 0),
    [threads],
  );

  return { connected, threads, totalUnread, send, sendImage, retry, setRoomVisible };
}
