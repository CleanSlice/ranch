import {
  WebSocketGateway,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Inject, Logger, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Socket } from 'socket.io';
import {
  IBridleGateway,
  type IBridleOutgoingEvent,
  type IBridleSyncResponse,
  type IBridleDebugEvent,
  type IBridleThinkingEvent,
} from '../domain';
import { IAgentGateway } from '#/agent/agent/domain/agent.gateway';
import {
  ChatSourceService,
  IChatGateway,
  type IChatActivity,
  type IChatSourceInput,
  CHAT_SOURCES_MAX,
} from '#/chat/domain';

/**
 * WebSocket gateway for AGENT runtime connections.
 * Agents connect here: ws://hub-host/ws/agent
 *
 * Auth: apiKey + agentId in Socket.IO handshake.
 * apiKey must match BRIDLE_API_KEY env var.
 * agentId identifies which agent this runtime serves.
 * Multiple agents can connect (one per agentId).
 *
 * Events (Agent → Hub):
 *   "register"    {}
 *   "message"     { clientId, text, messageId, ts }
 *   "stream"      { clientId, text, messageId, ts }
 *   "stream_end"  { clientId, text, messageId, ts }
 *   "typing"      { clientId, ts }
 *   "thinking"    { clientId, turnId, step?, done?, ts }
 *   "sources"     { clientId, messageId, text, sources[], ts }   (CLEAN-138)
 *   "sync_done"   { requestId, pushed, error? }
 *   "ping"        {}
 *
 * Events (Hub → Agent):
 *   "message"        { clientId, text, messageId, images? }
 *   "sync"           { requestId }
 *   "session_clear"  { channel }
 *   "pong"           {}
 */
@WebSocketGateway({ namespace: '/ws/agent', cors: { origin: '*' } })
export class BridleAgentWsHandler
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(BridleAgentWsHandler.name);

  constructor(
    private readonly hub: IBridleGateway,
    private readonly config: ConfigService,
    @Inject(forwardRef(() => IAgentGateway))
    private readonly agentGateway: IAgentGateway,
    private readonly chats: IChatGateway,
    @Inject(forwardRef(() => ChatSourceService))
    private readonly chatSources: ChatSourceService,
  ) {}

  handleConnection(client: Socket) {
    const auth = (client.handshake.auth ?? {}) as {
      apiKey?: string;
      agentId?: string;
      botId?: string;
    };
    const apiKey = auth.apiKey;
    // Legacy `botId` is accepted so runtimes still on the pre-0.3.0 SDK can
    // keep connecting during the rename rollout.
    const agentId = auth.agentId ?? auth.botId;
    const expectedKey = this.config.get<string>('BRIDLE_API_KEY');

    if (!apiKey || !agentId || apiKey !== expectedKey) {
      this.logger.warn(
        `Agent connection rejected: invalid credentials (agentId: ${agentId ?? 'none'})`,
      );
      client.disconnect(true);
      return;
    }

    client.data = { agentId };

    const send = (data: unknown) => {
      const event =
        ((data as Record<string, unknown>)?.type as string) ?? 'data';
      client.emit(event, data);
    };
    client.data.send = send;

    this.hub.registerAgent(agentId, client.id, send);
    this.logger.log(`Agent connected: agentId=${agentId}`);

    // Rehydrate debug flag from DB so a freshly-started agent picks up
    // whatever the admin toggled while it was offline. We do this fire-
    // and-forget — debug is non-critical, and the WS handshake shouldn't
    // block on a DB query.
    this.agentGateway
      .findById(agentId)
      .then((agent) => {
        if (agent?.debugEnabled) {
          this.hub.setDebug(agentId, true);
        }
      })
      .catch((err: Error) => {
        this.logger.warn(
          `Debug rehydrate failed for ${agentId}: ${err.message}`,
        );
      });
  }

  handleDisconnect(client: Socket) {
    const agentId = client.data?.agentId as string | undefined;
    if (agentId) {
      // Socket-scoped: a stale connection's late disconnect (old pod detected
      // via ping timeout after the new pod already registered) is a no-op in
      // the hub — see BridleGateway.unregisterAgent.
      this.hub.unregisterAgent(agentId, client.id);
      this.logger.warn(`Agent disconnected: agentId=${agentId}`);
    }
  }

  // Self-heal: if this socket's registration was ever wiped while the socket
  // itself stayed alive (any residue of registry races), the next inbound
  // event restores it — the handshake already authenticated this socket for
  // this agentId, so re-registering is safe and idempotent.
  private ensureRegistered(client: Socket): void {
    const agentId = client.data?.agentId as string | undefined;
    const send = client.data?.send as ((data: unknown) => void) | undefined;
    if (!agentId || !send) return;
    if (this.hub.isAgentSocket(agentId, client.id)) return;
    this.logger.warn(
      `Re-registering live agent socket that lost its registration: agentId=${agentId}`,
    );
    this.hub.registerAgent(agentId, client.id, send);
  }

  @SubscribeMessage('message')
  handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: IBridleOutgoingEvent,
  ) {
    this.ensureRegistered(client);
    const agentId = client.data?.agentId as string;
    if (data?.clientId && agentId) {
      this.hub.handleAgentEvent(agentId, { ...data, type: 'message' });
    }
  }

  @SubscribeMessage('stream')
  handleStream(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: IBridleOutgoingEvent,
  ) {
    this.ensureRegistered(client);
    const agentId = client.data?.agentId as string;
    if (data?.clientId && agentId) {
      this.hub.handleAgentEvent(agentId, { ...data, type: 'stream' });
    }
  }

  @SubscribeMessage('stream_end')
  handleStreamEnd(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: IBridleOutgoingEvent,
  ) {
    this.ensureRegistered(client);
    const agentId = client.data?.agentId as string;
    if (data?.clientId && agentId) {
      this.hub.handleAgentEvent(agentId, { ...data, type: 'stream_end' });
    }
  }

  /**
   * One bubble's citations (CLEAN-138), sent by the runtime after that
   * bubble's `stream_end` / `message`. Recorded before it is relayed, so the
   * frame a browser receives already has a persisted twin: a rating sent a
   * second later finds its row, and history shows the same list after the
   * runtime has compacted its transcript. The relayed frame carries the
   * reader-facing entries, never the runtime's ids.
   */
  @SubscribeMessage('sources')
  async handleSources(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: Record<string, unknown>,
  ) {
    this.ensureRegistered(client);
    const agentId = client.data?.agentId as string | undefined;
    if (!agentId) return;
    const event = readSourcesEvent(data);
    if (!event) {
      this.logger.warn(
        `Dropping malformed sources event from agent=${agentId}: ${describeShape(data)}`,
      );
      return;
    }
    try {
      await this.chatSources.record({ agentId, ...event });
      const entries =
        (
          await this.chatSources.forMessages([event.messageId], {
            clientId: event.clientId,
            isAdmin: event.clientId === 'admin',
          })
        ).get(event.messageId) ?? [];
      this.hub.handleAgentEvent(agentId, {
        type: 'sources',
        clientId: event.clientId,
        messageId: event.messageId,
        text: event.text,
        sources: entries,
        ts: event.ts,
      });
    } catch (e) {
      // The bubble is already on screen as streamed; losing its list is a
      // degraded answer, not a broken one. Logged, not thrown.
      const message = e instanceof Error ? e.message : String(e);
      this.logger.warn(
        `Dropping sources event for agent=${agentId} message=${event.messageId}: ${message}`,
      );
    }
  }

  @SubscribeMessage('typing')
  handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: IBridleOutgoingEvent,
  ) {
    this.ensureRegistered(client);
    const agentId = client.data?.agentId as string;
    if (data?.clientId && agentId) {
      this.hub.handleAgentEvent(agentId, { ...data, type: 'typing' });
    }
  }

  @SubscribeMessage('thinking')
  handleThinking(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: IBridleThinkingEvent,
  ) {
    this.ensureRegistered(client);
    const agentId = client.data?.agentId as string;
    if (data?.clientId && data?.turnId && agentId) {
      this.hub.handleAgentEvent(agentId, { ...data, type: 'thinking' });
    }
  }

  @SubscribeMessage('sync_done')
  handleSyncDone(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: IBridleSyncResponse,
  ) {
    this.ensureRegistered(client);
    const agentId = client.data?.agentId as string;
    if (agentId && data?.requestId) {
      this.hub.handleSyncResponse(agentId, data);
    }
  }

  @SubscribeMessage('session_activity')
  handleSessionActivity(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: IChatActivity,
  ) {
    this.ensureRegistered(client);
    // agentId comes from the authenticated socket — never trusted from payload.
    const agentId = client.data?.agentId as string;
    if (!agentId || !data?.sessionKey) return;
    if (data.role !== 'user' && data.role !== 'assistant') return;
    void this.chats
      .recordActivity(agentId, data)
      .catch((err: Error) =>
        this.logger.warn(
          `session_activity record failed for ${agentId}: ${err.message}`,
        ),
      );
  }

  @SubscribeMessage('debug')
  handleDebug(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: IBridleDebugEvent,
  ) {
    this.ensureRegistered(client);
    const agentId = client.data?.agentId as string;
    if (agentId) {
      this.hub.handleDebugEvent(agentId, { ...data, type: 'debug' });
    }
  }

  @SubscribeMessage('ping')
  handlePing(@ConnectedSocket() client: Socket) {
    this.ensureRegistered(client);
    client.emit('pong', {});
  }
}

/** What `handleSources` needs from the wire, or null when the frame is not it. */
export function readSourcesEvent(data: unknown): {
  clientId: string;
  messageId: string;
  text: string;
  sources: IChatSourceInput[];
  ts: number;
} | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (typeof d.clientId !== 'string' || !d.clientId) return null;
  if (typeof d.messageId !== 'string' || !d.messageId) return null;
  if (typeof d.text !== 'string') return null;
  if (!Array.isArray(d.sources) || d.sources.length === 0) return null;
  if (d.sources.length > CHAT_SOURCES_MAX) return null;
  const sources: IChatSourceInput[] = [];
  for (const raw of d.sources) {
    const s = readSource(raw);
    if (!s) return null;
    sources.push(s);
  }
  return {
    clientId: d.clientId,
    messageId: d.messageId,
    text: d.text,
    sources,
    ts: typeof d.ts === 'number' ? d.ts : Date.now(),
  };
}

function readSource(raw: unknown): IChatSourceInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (s.kind === 'web') {
    if (typeof s.url !== 'string') return null;
    return {
      kind: 'web',
      url: s.url,
      title: typeof s.title === 'string' ? s.title : null,
    };
  }
  if (s.kind === 'knowledge') {
    if (typeof s.id !== 'string' || typeof s.name !== 'string') return null;
    return {
      kind: 'knowledge',
      id: s.id,
      name: s.name,
      knowledgeId: typeof s.knowledgeId === 'string' ? s.knowledgeId : '',
      knowledgeName:
        typeof s.knowledgeName === 'string' ? s.knowledgeName : null,
    };
  }
  return null;
}

function describeShape(data: unknown): string {
  if (!data || typeof data !== 'object') return typeof data;
  const d = data as Record<string, unknown>;
  const n = Array.isArray(d.sources) ? d.sources.length : 'none';
  return `clientId=${typeof d.clientId} messageId=${typeof d.messageId} text=${typeof d.text} sources=${n}`;
}
