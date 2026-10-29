import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CaseChatMessage } from './entities/case-chat-message.entity';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../common/enums';
import { CaseAccessService } from '../access/case-access.service';
import { isTokenRevoked } from '../auth/session-revocation';

/** The verified account behind a socket, attached once at connect. */
export interface SocketUser {
  id: string;
  role: UserRole;
  hospitalId: string | null;
  ambulanceId: string | null;
  name: string;
}

type ChatRole = 'patient' | 'driver';

/**
 * Everyone with a stake in one case. Events about the case go to exactly these
 * rooms (plus admins), never to every connected socket.
 */
export interface CaseParties {
  patientId?: string | null;
  hospitalIds?: (string | null | undefined)[];
  ambulanceId?: string | null;
  driverId?: string | null;
}

/**
 * Realtime Gateway
 *
 * Every socket must present a valid login when it connects — the same JWT the
 * REST API takes — and is then placed in rooms derived from that account alone:
 * its own user room, its role room, and its hospital or ambulance room. Rooms a
 * client asks to join (a hospital, a case chat) are checked against the account
 * before the join happens. Server-side events are sent to the rooms of the
 * people on the case they concern; nothing about a patient is broadcast.
 *
 * Origin checking happens a step earlier, in OriginCheckedIoAdapter.
 */
@WebSocketGateway()
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  static readonly ADMIN_ROOM = `role:${UserRole.ADMIN}`;
  static userRoom = (id: string) => `user:${id}`;
  static hospitalRoom = (id: string) => `hospital:${id}`;
  static ambulanceRoom = (id: string) => `ambulance:${id}`;
  static caseChatRoom = (bookingId: string) => `case-chat:${bookingId}`;

  private readonly logger = new Logger(RealtimeGateway.name);

  /**
   * sender + clientId -> saved message, so a client replaying a send after a
   * dropped ack gets the original back instead of creating a duplicate. Keyed by
   * sender too, so nobody can fetch another user's message by guessing its id.
   */
  private readonly sentClientIds = new Map<string, any>();
  private static readonly SENT_CLIENT_ID_LIMIT = 5000;

  constructor(
    @InjectRepository(CaseChatMessage)
    private readonly caseChatMessages: Repository<CaseChatMessage>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly caseAccess: CaseAccessService,
  ) {}

  /**
   * Authenticate in the handshake, before Nest sees the connection. A rejected
   * client gets `connect_error` with "Unauthorized" and never reaches a handler.
   */
  afterInit(server: Server) {
    server.use(async (socket, next) => {
      try {
        socket.data.user = await this.authenticate(socket);
        next();
      } catch (error: any) {
        this.logger.warn(`Rejected socket ${socket.id}: ${error?.message ?? error}`);
        next(new Error('Unauthorized'));
      }
    });
  }

  private async authenticate(socket: Socket): Promise<SocketUser> {
    const token = this.extractToken(socket);
    if (!token) throw new Error('missing token');

    const payload = await this.jwtService.verifyAsync(token);
    // Read the account fresh rather than trusting the token's claims: a hospital
    // or ambulance link can change after the token was issued, and a
    // deactivated account must lose its live feed immediately.
    const user = await this.users.findOne({ where: { id: payload?.sub } });
    if (!user || !user.isActive) throw new Error('unknown or inactive account');
    if (isTokenRevoked(user, payload?.iat)) throw new Error('session revoked');

    const fullName = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
    return {
      id: user.id,
      role: user.role,
      hospitalId: user.hospitalId ?? null,
      ambulanceId: user.ambulanceId ?? null,
      name: fullName || user.email?.split('@')[0] || 'User',
    };
  }

  private extractToken(socket: Socket): string | null {
    const fromAuth = socket.handshake?.auth?.token;
    if (typeof fromAuth === 'string' && fromAuth) return fromAuth;

    const fromQuery = socket.handshake?.query?.token;
    if (typeof fromQuery === 'string' && fromQuery) return fromQuery;

    const header = socket.handshake?.headers?.authorization;
    if (header?.startsWith('Bearer ')) return header.substring(7);

    return null;
  }

  private userOf(client: Socket): SocketUser {
    return client.data.user as SocketUser;
  }

  /** Place the socket in every room its account is entitled to. */
  handleConnection(@ConnectedSocket() client: Socket) {
    const user = this.userOf(client);
    if (!user) {
      client.disconnect(true);
      return;
    }

    const rooms = [RealtimeGateway.userRoom(user.id), `role:${user.role}`];
    if (user.role === UserRole.HOSPITAL && user.hospitalId) rooms.push(RealtimeGateway.hospitalRoom(user.hospitalId));
    if (user.role === UserRole.DRIVER && user.ambulanceId) rooms.push(RealtimeGateway.ambulanceRoom(user.ambulanceId));
    client.join(rooms);
    client.data.caseChats = {} as Record<string, ChatRole>;

    this.logger.log(`Client connected: ${client.id} (${user.role} ${user.id})`);
  }

  async handleDisconnect(@ConnectedSocket() client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    // Tell whoever is left that their peer dropped, so delivery ticks stay honest.
    for (const bookingId of Object.keys(client.data?.caseChats ?? {})) {
      await this.emitCaseChatPresence(bookingId);
    }
  }

  /** Keep-alive / connectivity test. */
  @SubscribeMessage('heartbeat')
  handleHeartbeat() {
    return { event: 'heartbeat', data: { timestamp: new Date().toISOString() } };
  }

  /**
   * Location update event (placeholder). Drivers report position over REST
   * (PATCH /ambulances/:id/location), which is where it is authorised and saved.
   */
  @SubscribeMessage('location:update')
  handleLocationUpdate() {
    return { event: 'location:update:ack', data: { received: true } };
  }

  /**
   * Hospital dashboards ask to join their hospital's room. A hospital account
   * is already placed in its own room at connect; this only confirms it, and
   * refuses any other hospital. Admins may watch any hospital.
   */
  @SubscribeMessage('join_hospital')
  handleJoinHospital(@ConnectedSocket() client: Socket, @MessageBody() data: { hospitalId?: string }) {
    const user = this.userOf(client);
    const hospitalId = data?.hospitalId;
    const allowed =
      Boolean(hospitalId) &&
      (user.role === UserRole.ADMIN || (user.role === UserRole.HOSPITAL && user.hospitalId === hospitalId));

    if (!allowed) {
      this.logger.warn(`Refused ${user.role} ${user.id} joining hospital room ${hospitalId}`);
      return { event: 'join_hospital_error', data: { hospitalId: hospitalId ?? null, message: 'Not your hospital' } };
    }

    client.join(RealtimeGateway.hospitalRoom(hospitalId!));
    return { event: 'joined_hospital', data: { hospitalId } };
  }

  /**
   * The chat room for a case is open to its patient and its assigned driver
   * only. Which of the two a socket is comes from the account, not from what
   * the client claims.
   */
  private async chatParticipant(
    user: SocketUser,
    data: { bookingId?: string; dispatchId?: string },
  ): Promise<{ bookingId: string; dispatchId: string | null; role: ChatRole } | null> {
    let bookingId = data?.bookingId;
    if (!bookingId && data?.dispatchId) {
      const viaDispatch = await this.caseAccess.assertDispatchAccess(user, data.dispatchId, ['driver']).catch(() => null);
      bookingId = viaDispatch?.dispatch.bookingId;
    }
    if (!bookingId) return null;

    const found = await this.caseAccess.loadCase(bookingId);
    if (!found) return null;
    const role = this.caseAccess.roleInCase(user, found.booking, found.dispatch);
    if (role !== 'patient' && role !== 'driver') return null;

    return { bookingId, dispatchId: found.dispatch?.id ?? null, role };
  }

  @SubscribeMessage('join_case_chat')
  async handleJoinCaseChat(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { bookingId?: string; dispatchId?: string },
  ) {
    const user = this.userOf(client);
    const participant = await this.chatParticipant(user, data);
    if (!participant) {
      return { event: 'case_chat_error', data: { message: 'You are not part of this case' } };
    }

    const { bookingId, role } = participant;
    client.data.caseChats[bookingId] = role;
    client.join(RealtimeGateway.caseChatRoom(bookingId));

    // Older messages may have been filed under the dispatch id, so match either.
    const messages = await this.caseChatMessages.find({
      where: [{ roomId: bookingId }, { bookingId }],
      order: { createdAt: 'ASC' },
    });
    client.emit('case_chat_history', {
      roomId: bookingId,
      messages: messages.map(message => this.toChatMessage(message, bookingId)),
    });
    this.logger.log(`Client ${client.id} joined case chat ${bookingId} as ${role}`);
    await this.emitCaseChatPresence(bookingId);
    return { event: 'joined_case_chat', data: { roomId: bookingId } };
  }

  @SubscribeMessage('case_chat_message')
  async handleCaseChatMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      bookingId?: string;
      dispatchId?: string;
      message?: string;
      /** Client-generated id used to match the optimistic bubble to the saved message. */
      clientId?: string;
      attachment?: {
        url?: string;
        type?: string;
        name?: string;
        size?: number;
        width?: number;
        height?: number;
      };
    },
  ) {
    const user = this.userOf(client);
    const text = (data?.message || '').trim().slice(0, 500);
    const attachment = this.sanitizeAttachment(data?.attachment);
    if (!text && !attachment) {
      return { event: 'case_chat_error', data: { message: 'Missing chat room or message' } };
    }

    // Re-checked on every message: a reassigned driver or a cancelled case
    // must stop being able to post even on a socket that joined earlier.
    const participant = await this.chatParticipant(user, data);
    if (!participant) {
      return { event: 'case_chat_error', data: { message: 'You are not part of this case' } };
    }
    const { bookingId, dispatchId, role } = participant;
    const room = RealtimeGateway.caseChatRoom(bookingId);

    // Replay of a send whose ack never made it back — return the original, do not save twice.
    const replayKey = data.clientId ? `${user.id}:${data.clientId}` : null;
    const alreadySent = replayKey ? this.sentClientIds.get(replayKey) : undefined;
    if (alreadySent) {
      const presence = await this.getCaseChatPresence(bookingId);
      const peerOnline = alreadySent.senderRole === 'driver' ? presence.patientOnline : presence.driverOnline;
      return { event: 'case_chat_message_ack', data: { ...alreadySent, peerOnline } };
    }

    const caseChatMessage = this.caseChatMessages.create({
      roomId: bookingId,
      bookingId,
      dispatchId,
      senderRole: role,
      senderName: user.name.slice(0, 80),
      message: text,
      attachmentUrl: attachment?.url ?? null,
      attachmentType: attachment?.type ?? null,
      attachmentName: attachment?.name ?? null,
      attachmentSize: attachment?.size ?? null,
      attachmentWidth: attachment?.width ?? null,
      attachmentHeight: attachment?.height ?? null,
    });

    let savedMessage: CaseChatMessage;
    try {
      savedMessage = await this.caseChatMessages.save(caseChatMessage);
    } catch (error) {
      this.logger.error(`Failed to save case chat message: ${error.message}`);
      return { event: 'case_chat_error', data: { message: 'Unable to save chat message' } };
    }

    const message = { ...this.toChatMessage(savedMessage, bookingId), clientId: data.clientId ?? null };
    if (replayKey) this.rememberClientId(replayKey, message);
    this.server.to(room).emit('case_chat_message', message);

    // "Delivered" means the other side is in the room right now and got the broadcast.
    const presence = await this.getCaseChatPresence(bookingId);
    const peerOnline = role === 'driver' ? presence.patientOnline : presence.driverOnline;

    return { event: 'case_chat_message_ack', data: { ...message, peerOnline } };
  }

  /** Cache a saved message against its sender + clientId, evicting oldest entries when full. */
  private rememberClientId(key: string, message: any) {
    if (this.sentClientIds.size >= RealtimeGateway.SENT_CLIENT_ID_LIMIT) {
      const oldest = this.sentClientIds.keys().next().value;
      if (oldest !== undefined) this.sentClientIds.delete(oldest);
    }
    this.sentClientIds.set(key, message);
  }

  /** Which roles are currently connected to a case chat room. */
  private async getCaseChatPresence(bookingId: string): Promise<{ patientOnline: boolean; driverOnline: boolean }> {
    try {
      const sockets = await this.server.in(RealtimeGateway.caseChatRoom(bookingId)).fetchSockets();
      const roles = new Set(sockets.map(socket => socket.data?.caseChats?.[bookingId]).filter(Boolean));
      return { patientOnline: roles.has('patient'), driverOnline: roles.has('driver') };
    } catch (error) {
      this.logger.warn(`Unable to read case chat presence for ${bookingId}: ${error.message}`);
      return { patientOnline: false, driverOnline: false };
    }
  }

  /** Broadcast who is currently in the room so both sides can show accurate delivery state. */
  private async emitCaseChatPresence(bookingId: string) {
    const presence = await this.getCaseChatPresence(bookingId);
    this.server.to(RealtimeGateway.caseChatRoom(bookingId)).emit('case_chat_presence', { roomId: bookingId, ...presence });
  }

  private toChatMessage(message: CaseChatMessage, roomId: string) {
    return {
      id: message.id,
      roomId,
      bookingId: message.bookingId,
      dispatchId: message.dispatchId,
      senderRole: message.senderRole,
      senderName: message.senderName,
      message: message.message,
      createdAt: message.createdAt.toISOString(),
      attachment: message.attachmentUrl
        ? {
            url: message.attachmentUrl,
            type: message.attachmentType,
            name: message.attachmentName,
            size: message.attachmentSize,
            width: message.attachmentWidth,
            height: message.attachmentHeight,
          }
        : null,
    };
  }

  /**
   * Only accept attachment URLs this server issued: the development disk path,
   * or an object in the configured Supabase Storage bucket. Without this a
   * client could point a message at any external URL and have both dashboards
   * render it.
   */
  private sanitizeAttachment(attachment?: {
    url?: string;
    type?: string;
    name?: string;
    size?: number;
    width?: number;
    height?: number;
  }) {
    const url = attachment?.url?.trim();
    if (!url || !this.isIssuedAttachmentUrl(url)) return null;

    const positiveInt = (value?: number) =>
      typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : null;

    return {
      url,
      type: (attachment?.type || 'image/jpeg').slice(0, 100),
      name: (attachment?.name || 'image').slice(0, 255),
      size: positiveInt(attachment?.size),
      width: positiveInt(attachment?.width),
      height: positiveInt(attachment?.height),
    };
  }

  private isIssuedAttachmentUrl(url: string): boolean {
    if (/^\/uploads\/chat\/[A-Za-z0-9._-]+$/.test(url)) return true;

    // Must match ChatImageStorageService.storeInSupabase exactly.
    const supabaseUrl = this.configService.get<string>('supabase.url', '');
    if (!supabaseUrl) return false;
    const bucket = this.configService.get<string>('supabase.storage.bucket', 'chat-attachments');
    const prefix = this.configService.get<string>('supabase.storage.prefix', 'chat').replace(/^\/+|\/+$/g, '');
    const base = `${supabaseUrl}/storage/v1/object/public/${bucket}/${prefix ? `${prefix}/` : ''}`;
    return url.startsWith(base) && /^[A-Za-z0-9._-]+$/.test(url.slice(base.length));
  }

  // ── Server-side events ────────────────────────────────────────────────────

  /** Admin consoles only — system-wide operational events. */
  emitToAdmins(event: string, data: any) {
    this.server.to(RealtimeGateway.ADMIN_ROOM).emit(event, data);
  }

  /** Everyone on one case, plus admins. A socket in several of the rooms gets it once. */
  emitToCase(parties: CaseParties, event: string, data: any) {
    const rooms = new Set<string>([RealtimeGateway.ADMIN_ROOM]);
    if (parties.patientId) rooms.add(RealtimeGateway.userRoom(parties.patientId));
    if (parties.driverId) rooms.add(RealtimeGateway.userRoom(parties.driverId));
    if (parties.ambulanceId) rooms.add(RealtimeGateway.ambulanceRoom(parties.ambulanceId));
    for (const hospitalId of parties.hospitalIds ?? []) {
      if (hospitalId) rooms.add(RealtimeGateway.hospitalRoom(hospitalId));
    }
    this.server.to([...rooms]).emit(event, data);
  }

  /**
   * Drop every live connection an account has. Its dashboards reconnect at
   * once and are re-checked from scratch — so a role change, a new hospital or
   * ambulance link, a deactivation or a sign-out takes effect on the live feed
   * immediately, not whenever the socket next happens to reconnect.
   */
  disconnectUser(userId: string): void {
    this.server.in(RealtimeGateway.userRoom(userId)).disconnectSockets(true);
  }

  /** A message from an admin to every dashboard, or to one role's. */
  broadcastAnnouncement(audience: UserRole | 'ALL', payload: { message: string; tone: string; from: string; at: string }) {
    const target = audience === 'ALL' ? this.server : this.server.to(`role:${audience}`);
    target.emit('system_announcement', payload);
  }

  /** How many sockets are connected now, by role. */
  async connectionStats(): Promise<Record<string, number>> {
    const sockets = await this.server.fetchSockets();
    const byRole: Record<string, number> = { total: sockets.length };
    for (const socket of sockets) {
      const role = (socket.data?.user as SocketUser | undefined)?.role ?? 'UNKNOWN';
      byRole[role] = (byRole[role] ?? 0) + 1;
    }
    return byRole;
  }

  /** Emit event to all clients in a hospital's room. */
  emitToHospital(hospitalId: string, event: string, data: any) {
    const room = RealtimeGateway.hospitalRoom(hospitalId);
    const roomSize = this.server.sockets.adapter.rooms.get(room)?.size ?? 0;
    this.logger.log(`[emitToHospital] event="${event}" room="${room}" clients=${roomSize}`);
    this.server.to(room).emit(event, data);
  }
}
