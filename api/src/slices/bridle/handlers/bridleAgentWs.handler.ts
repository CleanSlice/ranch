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
} from '../domain';
import { IAgentGateway } from '#/agent/agent/domain/agent.gateway';

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
 *   "sync_done"   { requestId, pushed, error? }
 *   "ping"        {}
 *
 * Events (Hub → Agent):
 *   "message"     { clientId, text, messageId, images? }
 *   "sync"        { requestId }
 *   "pong"        {}
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
  ) {}

  handleConnection(client: Socket) {
    const apiKey = client.handshake.auth?.apiKey as string | undefined;
    const agentId = client.handshake.auth?.agentId as string | undefined;
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

    this.hub.registerAgent(agentId, send);
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
        this.logger.warn(`Debug rehydrate failed for ${agentId}: ${err.message}`);
      });
  }

  handleDisconnect(client: Socket) {
    const agentId = client.data?.agentId as string | undefined;
    if (agentId) {
      this.hub.unregisterAgent(agentId);
      this.logger.warn(`Agent disconnected: agentId=${agentId}`);
    }
  }

  @SubscribeMessage('message')
  handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: IBridleOutgoingEvent,
  ) {
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
    const agentId = client.data?.agentId as string;
    if (data?.clientId && agentId) {
      this.hub.handleAgentEvent(agentId, { ...data, type: 'stream_end' });
    }
  }

  @SubscribeMessage('typing')
  handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: IBridleOutgoingEvent,
  ) {
    const agentId = client.data?.agentId as string;
    if (data?.clientId && agentId) {
      this.hub.handleAgentEvent(agentId, { ...data, type: 'typing' });
    }
  }

  @SubscribeMessage('sync_done')
  handleSyncDone(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: IBridleSyncResponse,
  ) {
    const agentId = client.data?.agentId as string;
    if (agentId && data?.requestId) {
      this.hub.handleSyncResponse(agentId, data);
    }
  }

  @SubscribeMessage('debug')
  handleDebug(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: IBridleDebugEvent,
  ) {
    const agentId = client.data?.agentId as string;
    if (agentId) {
      this.hub.handleDebugEvent(agentId, { ...data, type: 'debug' });
    }
  }

  @SubscribeMessage('ping')
  handlePing(@ConnectedSocket() client: Socket) {
    client.emit('pong', {});
  }
}
