import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Inject, Logger, forwardRef } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { IBridleGateway, type BridlePart, buildParts } from '../domain';
import { IAgentGateway } from '#/agent/agent/domain/agent.gateway';

/**
 * WebSocket gateway for BROWSER clients.
 * Browsers connect here: ws://hub-host/ws/client
 *
 * Auth (two paths):
 *   1. Public agent — agent has `isPublic: true` and the request `Origin` header
 *      matches one of `allowedOrigins`. No JWT required; clientId is anonymous.
 *   2. Authenticated — JWT token + agentId in handshake auth, JWT verified.
 *      Admin role grants `clientId = "admin"` for runtime ACL.
 *
 * Events (browser → hub):
 *   "message"  { text, images? }
 *   "ping"     {}
 *
 * Events (hub → browser):
 *   "welcome"     { clientId }
 *   "message"     { text, messageId, ts }
 *   "stream"      { text, messageId, ts }
 *   "stream_end"  { text, messageId, ts }
 *   "typing"      { ts }
 *   "pong"        { ts }
 */
@WebSocketGateway({ namespace: '/ws/client', cors: { origin: '*' } })
export class BridleClientWsHandler
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(BridleClientWsHandler.name);

  constructor(
    private readonly hub: IBridleGateway,
    private readonly jwt: JwtService,
    @Inject(forwardRef(() => IAgentGateway))
    private readonly agentGateway: IAgentGateway,
  ) {}

  async handleConnection(client: Socket) {
    const agentId = client.handshake.auth?.agentId as string | undefined;
    if (!agentId) {
      this.logger.warn('Browser connection rejected: missing agentId');
      client.disconnect(true);
      return;
    }

    const origin = client.handshake.headers.origin as string | undefined;
    const agent = await this.agentGateway.findById(agentId);

    let clientId: string;
    let isAdmin = false;
    let email: string | undefined;

    if (agent?.isPublic && origin && agent.allowedOrigins.includes(origin)) {
      // Public-agent path: anonymous browser session, no token required.
      clientId = `anon-${randomId()}`;
      this.logger.log(
        `Browser connected (public): clientId=${clientId} agentId=${agentId} origin=${origin}`,
      );
    } else {
      // Authenticated path: JWT required.
      const token = client.handshake.auth?.token as string | undefined;
      if (!token) {
        this.logger.warn(
          `Browser connection rejected: missing token (agentId=${agentId}, origin=${origin ?? 'none'})`,
        );
        client.disconnect(true);
        return;
      }

      let payload: Record<string, unknown>;
      try {
        payload = this.jwt.verify(token);
      } catch {
        this.logger.warn('Browser connection rejected: invalid JWT');
        client.disconnect(true);
        return;
      }

      const roles = payload.roles as string[] | undefined;
      isAdmin =
        Array.isArray(roles) &&
        (roles.includes('Owner') || roles.includes('Admin'));
      clientId = isAdmin ? 'admin' : (payload.sub as string);
      email = payload.email as string | undefined;
    }

    client.data = { clientId, agentId, email, isAdmin };

    const send = (data: unknown) => {
      const event =
        ((data as Record<string, unknown>)?.type as string) ?? 'data';
      client.emit(event, data);
    };

    this.hub.registerClient(clientId, agentId, send, isAdmin);
    client.emit('welcome', { clientId });

    this.logger.log(
      `Browser connected: clientId=${clientId} agentId=${agentId} admin=${isAdmin}`,
    );
  }

  handleDisconnect(client: Socket) {
    const clientId = client.data?.clientId as string | undefined;
    if (clientId) {
      this.hub.unregisterClient(clientId);
      this.logger.log(`Browser disconnected: clientId=${clientId}`);
    }
  }

  @SubscribeMessage('message')
  handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      text?: string;
      parts?: BridlePart[];
      images?: Array<{ base64: string; mediaType: string }>;
    },
  ) {
    const clientId = client.data?.clientId as string;
    const agentId = client.data?.agentId as string;
    if (!clientId || !agentId) return;

    const text = data.text ?? '';
    const parts = data.parts ?? buildParts(text, data.images);
    if (!text && parts.length === 0) return;

    this.hub.sendToAgent(clientId, agentId, text, parts);
  }

  @SubscribeMessage('ping')
  handlePing(@ConnectedSocket() client: Socket) {
    client.emit('pong', { ts: Date.now() });
  }
}

function randomId(): string {
  return (
    Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
  );
}
