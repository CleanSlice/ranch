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
 * Auth: apiKey + botId in Socket.IO handshake.
 * apiKey must match BRIDLE_API_KEY env var.
 * botId identifies which bot this agent serves.
 * Multiple agents can connect (one per botId).
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
    const botId = client.handshake.auth?.botId as string | undefined;
    const expectedKey = this.config.get<string>('BRIDLE_API_KEY');

    if (!apiKey || !botId || apiKey !== expectedKey) {
      this.logger.warn(
        `Agent connection rejected: invalid credentials (botId: ${botId ?? 'none'})`,
      );
      client.disconnect(true);
      return;
    }

    client.data = { botId };

    const send = (data: unknown) => {
      const event =
        ((data as Record<string, unknown>)?.type as string) ?? 'data';
      client.emit(event, data);
    };

    this.hub.registerAgent(botId, send);
    this.logger.log(`Agent connected: botId=${botId}`);

    // Rehydrate debug flag from DB so a freshly-started agent picks up
    // whatever the admin toggled while it was offline. We do this fire-
    // and-forget — debug is non-critical, and the WS handshake shouldn't
    // block on a DB query.
    this.agentGateway
      .findById(botId)
      .then((agent) => {
        if (agent?.debugEnabled) {
          this.hub.setDebug(botId, true);
        }
      })
      .catch((err: Error) => {
        this.logger.warn(`Debug rehydrate failed for ${botId}: ${err.message}`);
      });
  }

  handleDisconnect(client: Socket) {
    const botId = client.data?.botId as string | undefined;
    if (botId) {
      this.hub.unregisterAgent(botId);
      this.logger.warn(`Agent disconnected: botId=${botId}`);
    }
  }

  @SubscribeMessage('message')
  handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: IBridleOutgoingEvent,
  ) {
    const botId = client.data?.botId as string;
    if (data?.clientId && botId) {
      this.hub.handleAgentEvent(botId, { ...data, type: 'message' });
    }
  }

  @SubscribeMessage('stream')
  handleStream(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: IBridleOutgoingEvent,
  ) {
    const botId = client.data?.botId as string;
    if (data?.clientId && botId) {
      this.hub.handleAgentEvent(botId, { ...data, type: 'stream' });
    }
  }

  @SubscribeMessage('stream_end')
  handleStreamEnd(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: IBridleOutgoingEvent,
  ) {
    const botId = client.data?.botId as string;
    if (data?.clientId && botId) {
      this.hub.handleAgentEvent(botId, { ...data, type: 'stream_end' });
    }
  }

  @SubscribeMessage('typing')
  handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: IBridleOutgoingEvent,
  ) {
    const botId = client.data?.botId as string;
    if (data?.clientId && botId) {
      this.hub.handleAgentEvent(botId, { ...data, type: 'typing' });
    }
  }

  @SubscribeMessage('sync_done')
  handleSyncDone(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: IBridleSyncResponse,
  ) {
    const botId = client.data?.botId as string;
    if (botId && data?.requestId) {
      this.hub.handleSyncResponse(botId, data);
    }
  }

  @SubscribeMessage('debug')
  handleDebug(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: IBridleDebugEvent,
  ) {
    const botId = client.data?.botId as string;
    if (botId) {
      this.hub.handleDebugEvent(botId, { ...data, type: 'debug' });
    }
  }

  @SubscribeMessage('ping')
  handlePing(@ConnectedSocket() client: Socket) {
    client.emit('pong', {});
  }
}
