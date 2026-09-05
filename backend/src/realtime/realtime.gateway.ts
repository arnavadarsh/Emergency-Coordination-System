import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { UseGuards, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WsJwtGuard } from './guards/ws-jwt.guard';
import { CaseChatMessage } from './entities/case-chat-message.entity';

/**
 * Realtime Gateway
 * WebSocket foundation for real-time communication
 * Phase 0: Basic connection, authentication, and placeholder events
 * NO BUSINESS LOGIC (dispatch, routing, tracking)
 */
@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  /**
   * clientId -> saved message, so a client replaying a send after a dropped ack
   * gets the original back instead of creating a duplicate.
   */
  private readonly sentClientIds = new Map<string, any>();
  private static readonly SENT_CLIENT_ID_LIMIT = 5000;

  constructor(
    @InjectRepository(CaseChatMessage)
    private readonly caseChatMessages: Repository<CaseChatMessage>,
  ) {}

  /**
   * Handle client connection
   * Logs connection for debugging
   */
  handleConnection(@ConnectedSocket() client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  /**
   * Handle client disconnection
   * Logs disconnection for debugging
   */
  async handleDisconnect(@ConnectedSocket() client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    // Tell whoever is left that their peer dropped, so delivery ticks stay honest.
    const room = client.data?.caseChatRoom;
    const roomId = client.data?.caseChatRoomId;
    if (room && roomId) {
      await this.emitCaseChatPresence(room, roomId);
    }
  }

  /**
   * Heartbeat event
   * Used to keep connection alive and test connectivity
   */
  @SubscribeMessage('heartbeat')
  @UseGuards(WsJwtGuard)
  handleHeartbeat(@ConnectedSocket() client: Socket, @MessageBody() data: any) {
    this.logger.debug(`Heartbeat received from ${client.id}: ${JSON.stringify(data)}`);
    return { event: 'heartbeat', data: { timestamp: new Date().toISOString() } };
  }

  /**
   * Location update event (placeholder)
   * Phase 0: Just logs the payload, no business logic
   * Future phases will implement tracking and dispatch logic
   */
  @SubscribeMessage('location:update')
  @UseGuards(WsJwtGuard)
  handleLocationUpdate(@ConnectedSocket() client: Socket, @MessageBody() data: any) {
    this.logger.debug(`Location update from ${client.id}: ${JSON.stringify(data)}`);
    // TODO: Implement location tracking in later phases
    return { event: 'location:update:ack', data: { received: true } };
  }

  /**
   * Join hospital room
   * Hospital dashboards call this to receive events scoped to their hospital
   */
  @SubscribeMessage('join_hospital')
  handleJoinHospital(@ConnectedSocket() client: Socket, @MessageBody() data: { hospitalId: string }) {
    if (data?.hospitalId) {
      client.join(`hospital:${data.hospitalId}`);
      this.logger.log(`Client ${client.id} joined hospital room: ${data.hospitalId}`);
    }
    return { event: 'joined_hospital', data: { hospitalId: data?.hospitalId } };
  }

  @SubscribeMessage('join_case_chat')
  async handleJoinCaseChat(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { bookingId?: string; dispatchId?: string; role?: 'patient' | 'driver' },
  ) {
    const roomId = data?.bookingId || data?.dispatchId;
    if (!roomId) {
      return { event: 'case_chat_error', data: { message: 'Missing booking or dispatch id' } };
    }

    const room = `case-chat:${roomId}`;
    client.data.caseChatRole = data?.role === 'driver' ? 'driver' : 'patient';
    client.data.caseChatRoom = room;
    client.data.caseChatRoomId = roomId;
    client.join(room);
    const messages = await this.caseChatMessages.find({
      where: { roomId },
      order: { createdAt: 'ASC' },
    });
    client.emit('case_chat_history', {
      roomId,
      messages: messages.map(message => this.toChatMessage(message)),
    });
    this.logger.log(`Client ${client.id} joined case chat room: ${room}`);
    await this.emitCaseChatPresence(room, roomId);
    return { event: 'joined_case_chat', data: { roomId } };
  }

  @SubscribeMessage('case_chat_message')
  async handleCaseChatMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      bookingId?: string;
      dispatchId?: string;
      senderRole?: 'patient' | 'driver';
      senderName?: string;
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
    const roomId = data?.bookingId || data?.dispatchId;
    const text = (data?.message || '').trim().slice(0, 500);
    const attachment = this.sanitizeAttachment(data?.attachment);
    if (!roomId || (!text && !attachment)) {
      return { event: 'case_chat_error', data: { message: 'Missing chat room or message' } };
    }

    // Replay of a send whose ack never made it back — return the original, do not save twice.
    const alreadySent = data.clientId ? this.sentClientIds.get(data.clientId) : undefined;
    if (alreadySent) {
      const presence = await this.getCaseChatPresence(`case-chat:${roomId}`);
      const peerOnline = alreadySent.senderRole === 'driver' ? presence.patientOnline : presence.driverOnline;
      return { event: 'case_chat_message_ack', data: { ...alreadySent, peerOnline } };
    }

    const caseChatMessage = this.caseChatMessages.create({
      roomId,
      bookingId: data.bookingId ?? null,
      dispatchId: data.dispatchId ?? null,
      senderRole: data.senderRole === 'driver' ? 'driver' : 'patient',
      senderName: (data.senderName || data.senderRole || 'User').slice(0, 80),
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

    const room = `case-chat:${roomId}`;
    const message = { ...this.toChatMessage(savedMessage), clientId: data.clientId ?? null };
    if (data.clientId) this.rememberClientId(data.clientId, message);
    this.server.to(room).emit('case_chat_message', message);

    // "Delivered" means the other side is in the room right now and got the broadcast.
    const presence = await this.getCaseChatPresence(room);
    const peerOnline = savedMessage.senderRole === 'driver' ? presence.patientOnline : presence.driverOnline;

    return { event: 'case_chat_message_ack', data: { ...message, peerOnline } };
  }

  /** Cache a saved message against its clientId, evicting oldest entries when full. */
  private rememberClientId(clientId: string, message: any) {
    if (this.sentClientIds.size >= RealtimeGateway.SENT_CLIENT_ID_LIMIT) {
      const oldest = this.sentClientIds.keys().next().value;
      if (oldest !== undefined) this.sentClientIds.delete(oldest);
    }
    this.sentClientIds.set(clientId, message);
  }

  /** Which roles are currently connected to a case chat room. */
  private async getCaseChatPresence(room: string): Promise<{ patientOnline: boolean; driverOnline: boolean }> {
    try {
      const sockets = await this.server.in(room).fetchSockets();
      const roles = new Set(sockets.map(socket => socket.data?.caseChatRole).filter(Boolean));
      return { patientOnline: roles.has('patient'), driverOnline: roles.has('driver') };
    } catch (error) {
      this.logger.warn(`Unable to read case chat presence for ${room}: ${error.message}`);
      return { patientOnline: false, driverOnline: false };
    }
  }

  /** Broadcast who is currently in the room so both sides can show accurate delivery state. */
  private async emitCaseChatPresence(room: string, roomId: string) {
    const presence = await this.getCaseChatPresence(room);
    this.server.to(room).emit('case_chat_presence', { roomId, ...presence });
  }

  private toChatMessage(message: CaseChatMessage) {
    return {
      id: message.id,
      roomId: message.roomId,
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
   * Only accept attachment URLs this server issued. Without this a client could point a
   * message at any external URL and have both dashboards render it.
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
    if (!url || !/^\/uploads\/chat\/[A-Za-z0-9._-]+$/.test(url)) return null;

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

  /**
   * Broadcast message to all connected clients
   * Utility method for future use
   */
  broadcastMessage(event: string, data: any) {
    this.server.emit(event, data);
  }

  /**
   * Send message to specific client
   * Utility method for future use
   */
  sendToClient(clientId: string, event: string, data: any) {
    this.server.to(clientId).emit(event, data);
  }

  /**
   * Emit event to all clients in a hospital's room
   */
  emitToHospital(hospitalId: string, event: string, data: any) {
    const room = `hospital:${hospitalId}`;
    const roomSize = this.server.sockets.adapter.rooms.get(room)?.size ?? 0;
    this.logger.log(`[emitToHospital] event="${event}" room="${room}" clients=${roomSize}`);
    this.server.to(room).emit(event, data);
  }
}
