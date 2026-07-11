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
import { WsJwtGuard } from './guards/ws-jwt.guard';

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
  private readonly chatHistory = new Map<string, any[]>();

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
  handleDisconnect(@ConnectedSocket() client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
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
  handleJoinCaseChat(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { bookingId?: string; dispatchId?: string },
  ) {
    const roomId = data?.bookingId || data?.dispatchId;
    if (!roomId) {
      return { event: 'case_chat_error', data: { message: 'Missing booking or dispatch id' } };
    }

    const room = `case-chat:${roomId}`;
    client.join(room);
    const messages = this.chatHistory.get(roomId) ?? [];
    client.emit('case_chat_history', { roomId, messages });
    this.logger.log(`Client ${client.id} joined case chat room: ${room}`);
    return { event: 'joined_case_chat', data: { roomId } };
  }

  @SubscribeMessage('case_chat_message')
  handleCaseChatMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      bookingId?: string;
      dispatchId?: string;
      senderRole?: 'patient' | 'driver';
      senderName?: string;
      message?: string;
    },
  ) {
    const roomId = data?.bookingId || data?.dispatchId;
    const text = (data?.message || '').trim().slice(0, 500);
    if (!roomId || !text) {
      return { event: 'case_chat_error', data: { message: 'Missing chat room or message' } };
    }

    const message = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      roomId,
      bookingId: data.bookingId,
      dispatchId: data.dispatchId,
      senderRole: data.senderRole === 'driver' ? 'driver' : 'patient',
      senderName: (data.senderName || data.senderRole || 'User').slice(0, 80),
      message: text,
      createdAt: new Date().toISOString(),
    };

    const history = [...(this.chatHistory.get(roomId) ?? []), message].slice(-50);
    this.chatHistory.set(roomId, history);
    this.server.to(`case-chat:${roomId}`).emit('case_chat_message', message);
    return { event: 'case_chat_message_ack', data: message };
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
