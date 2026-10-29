import { IncomingMessage } from 'http';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';
import { corsOriginOption, isOriginAllowed } from '../config/cors';

/**
 * Socket.IO adapter that only accepts connections from our own dashboards.
 *
 * Socket.IO's `cors` setting only covers the HTTP long-polling transport — a
 * browser opens a WebSocket upgrade without any CORS check at all, and every
 * dashboard here connects with `transports: ['websocket']`. So the Origin header
 * is also checked in `allowRequest`, which runs for both transports before the
 * handshake completes.
 */
export class OriginCheckedIoAdapter extends IoAdapter {
  createIOServer(port: number, options?: ServerOptions): any {
    return super.createIOServer(port, {
      ...options,
      cors: { origin: corsOriginOption(), credentials: true },
      allowRequest: (req: IncomingMessage, callback: (err: string | null | undefined, success: boolean) => void) => {
        const allowed = isOriginAllowed(req.headers.origin);
        callback(allowed ? null : 'Origin not allowed', allowed);
      },
    });
  }
}
