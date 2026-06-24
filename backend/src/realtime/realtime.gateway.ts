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

  /**
   * Join a booking's chat room. Both the patient and the assigned driver call
   * this so they receive `chat:message` events for that booking in realtime.
   */
  @SubscribeMessage('chat:join')
  handleChatJoin(@ConnectedSocket() client: Socket, @MessageBody() data: { bookingId: string }) {
    if (data?.bookingId) {
      client.join(`booking:${data.bookingId}`);
      this.logger.log(`Client ${client.id} joined booking room: ${data.bookingId}`);
    }
    return { event: 'chat:joined', data: { bookingId: data?.bookingId } };
  }

  @SubscribeMessage('chat:leave')
  handleChatLeave(@ConnectedSocket() client: Socket, @MessageBody() data: { bookingId: string }) {
    if (data?.bookingId) client.leave(`booking:${data.bookingId}`);
    return { event: 'chat:left', data: { bookingId: data?.bookingId } };
  }

  /** Relay a transient "typing…" indicator to the other party (not persisted). */
  @SubscribeMessage('chat:typing')
  handleChatTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { bookingId: string; role: string },
  ) {
    if (data?.bookingId) {
      client.to(`booking:${data.bookingId}`).emit('chat:typing', {
        bookingId: data.bookingId,
        role: data.role,
      });
    }
  }

  /** Emit an event to everyone in a booking's room (patient + driver). */
  emitToBooking(bookingId: string, event: string, data: any) {
    const room = `booking:${bookingId}`;
    const roomSize = this.server.sockets.adapter.rooms.get(room)?.size ?? 0;
    this.logger.log(`[emitToBooking] event="${event}" room="${room}" clients=${roomSize}`);
    this.server.to(room).emit(event, data);
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
