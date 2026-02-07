import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { WsException } from '@nestjs/websockets';

/**
 * WebSocket JWT Guard
 * Validates JWT tokens for WebSocket connections
 * Extracts token from query params or auth header
 */
@Injectable()
export class WsJwtGuard implements CanActivate {
  constructor(private jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      const client = context.switchToWs().getClient();
      const token = this.extractToken(client);

      if (!token) {
        throw new WsException('Missing authentication token');
      }

      const payload = await this.jwtService.verifyAsync(token);
      client.user = payload;

      return true;
    } catch (error) {
      throw new WsException('Invalid authentication token');
    }
  }

  /**
   * Extract JWT token from WebSocket connection
   * Checks both query params and handshake auth
   */
  private extractToken(client: any): string | null {
    // Try query params first (e.g., ?token=xxx)
    if (client.handshake?.query?.token) {
      return client.handshake.query.token;
    }

    // Try auth object (e.g., { auth: { token: 'xxx' } })
    if (client.handshake?.auth?.token) {
      return client.handshake.auth.token;
    }

    // Try Authorization header
    const authHeader = client.handshake?.headers?.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }

    return null;
  }
}
