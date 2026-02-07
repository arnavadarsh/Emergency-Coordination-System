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
}
