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
 *   "welcome"       { clientId }
 *   "message"       { text, messageId, ts }
 *   "stream"        { text, messageId, ts }
 *   "stream_end"    { text, messageId, ts }
 *   "typing"        { ts }
 *   "pong"          { ts }
 *   "bridle_error"  { code, agentId?, origin? }  // emitted just before a rejected handshake disconnects, so the SDK can show a reason
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
    const auth = (client.handshake.auth ?? {}) as {
      agentId?: string;
      botId?: string;
      token?: string;
    };
    // Accept legacy `botId` from browsers running cached pre-0.3.0 SDK
    // bundles. Drop after CDN/embedders have rolled forward.
    const agentId = auth.agentId ?? auth.botId;
    const origin = client.handshake.headers.origin;

    // Emit a structured reason then drop the connection. Plain `disconnect()`
    // sends a namespace DISCONNECT after the queued event, so the SDK
    // reliably sees `bridle_error` first; `disconnect(true)` would force the
    // engine.io transport closed before the event packet flushes.
    const reject = (code: string, extra?: Record<string, unknown>) => {
      client.emit('bridle_error', {
        code,
        agentId,
        origin,
        ...(extra ?? {}),
      });
      client.disconnect();
    };

    if (!agentId) {
      this.logger.warn('Browser connection rejected: missing agentId');
      return reject('MISSING_AGENT_ID');
    }

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
    } else if (auth.token) {
      // Authenticated path: JWT required.
      let payload: Record<string, unknown>;
      try {
        payload = this.jwt.verify(auth.token);
      } catch {
        this.logger.warn('Browser connection rejected: invalid JWT');
        return reject('INVALID_TOKEN');
      }

      const roles = payload.roles as string[] | undefined;
      isAdmin =
        Array.isArray(roles) &&
        (roles.includes('Owner') || roles.includes('Admin'));
      clientId = isAdmin ? 'admin' : (payload.sub as string);
      email = payload.email as string | undefined;
    } else {
      // No token AND public flow either disabled or origin not whitelisted.
      // When the agent IS configured public, surface ORIGIN_NOT_ALLOWED so
      // the embed UI can prompt the integrator to whitelist their domain.
      const code = agent?.isPublic ? 'ORIGIN_NOT_ALLOWED' : 'MISSING_TOKEN';
      this.logger.warn(
        `Browser connection rejected: ${code} (agentId=${agentId}, origin=${origin ?? 'none'})`,
      );
      return reject(code);
    }

    client.data = { clientId, agentId, email, isAdmin };

    const send = (data: unknown) => {
      const event =
        ((data as Record<string, unknown>)?.type as string) ?? 'data';
      client.emit(event, data);
    };

    this.hub.registerClient(clientId, agentId, send, isAdmin);
    client.emit('welcome', { clientId });
    // Tell the new client whether the agent runtime is currently online so the
    // chat header can render the right indicator color before any subsequent
    // register/unregister broadcasts.
    client.emit('agent_status', {
      type: 'agent_status',
      agentId,
      connected: this.hub.isAgentConnected(agentId),
    });

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
