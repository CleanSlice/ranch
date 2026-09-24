import { Injectable, Logger } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import {
  IBridleGateway,
  ISyncAgentResult,
  IBridleAgentEvent,
} from '../domain/bridle.gateway';
import type {
  IBridleHealthData,
  IBridleAgentHealthData,
  IBridleOutgoingEvent,
  IBridleSyncResponse,
  IBridleDebugEvent,
  IBridleClientData,
  BridlePart,
  IBridleAttachment,
  IActiveTurn,
  IBridleSendOptions,
  BridleSendResult,
  IBridleUserIdentity,
  IBridleMcpConnectedEvent,
} from '../domain/bridle.types';
import { randomUUID } from 'crypto';

interface IPendingSync {
  resolve: (value: ISyncAgentResult) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
  agentId: string;
}

const DEFAULT_SYNC_TIMEOUT_MS = 15_000;

/** How much a reconnecting browser can catch up on — whichever runs out first. */
const REPLAY_MAX_EVENTS = 500;
const REPLAY_MAX_AGE_MS = 10 * 60_000;
/** A conversation nobody is connected to is forgotten after this long. */
const CHANNEL_IDLE_MS = REPLAY_MAX_AGE_MS;
/** How long a message id is remembered, so a resend is not delivered twice. */
const SEEN_TTL_MS = 10 * 60_000;
const SEEN_MAX = 200;

interface IBufferedEvent {
  at: number;
  event: Record<string, unknown> & { seq: number };
}

interface IClientChannel {
  /** Every socket open on this conversation, by socket id. */
  sockets: Map<string, IBridleClientData>;
  /** Last number issued; strictly increasing for the conversation's life. */
  seq: number;
  buffer: IBufferedEvent[];
  /** clientMessageId → when it was accepted. */
  seen: Map<string, number>;
  idleTimer?: NodeJS.Timeout;
}

/**
 * Hub implementation — manages per-agent connections and per-agent browser
 * client connections. Routes messages between them scoped by agentId.
 */
@Injectable()
export class BridleGateway extends IBridleGateway {
  private readonly logger = new Logger(BridleGateway.name);

  /** Agent connections: agentId → owning socket + send function. Tracking the
   * owning socketId prevents the duplicate-connection race: during a restart
   * the OLD pod's socket can disconnect AFTER the new pod already registered
   * (blackholed TCP is only detected by the server's ping timeout), and an
   * agentId-keyed delete would wipe the NEW registration — leaving a healthy
   * runtime invisible ("Agent reconnecting…") until its next restart. */
  private agents = new Map<
    string,
    { socketId: string; send: (data: unknown) => void; connectedAt: number }
  >();

  /**
   * Browser clients keyed by `${clientId}\u0000${agentId}`. Keying by the pair
   * (not clientId alone) lets ONE user hold several concurrent conversations —
   * e.g. a multi-slot dashboard chatting with N agents.
   *
   * A conversation holds EVERY socket open on it, not one (CLEAN-102). An
   * identity is routinely open in several places at once — two tabs, the admin
   * panel beside the console, a colleague (every Owner/Admin shares
   * clientId='admin'), an HTTP sendAndAwait — and with a single slot the last
   * one to connect took every event while the others sat on a spinner for an
   * answer that was delivered somewhere else.
   *
   * It also outlives its sockets for a while: events are numbered and kept in
   * a bounded buffer so a browser that was mid-reconnect when the answer
   * landed can ask for what it missed instead of never seeing it.
   */
  private channels = new Map<string, IClientChannel>();

  private clientKey(clientId: string, agentId: string): string {
    return `${clientId}\u0000${agentId}`;
  }

  private *sockets(): IterableIterator<IBridleClientData> {
    for (const channel of this.channels.values()) {
      yield* channel.sockets.values();
    }
  }

  private channelFor(clientId: string, agentId: string): IClientChannel {
    const key = this.clientKey(clientId, agentId);
    let channel = this.channels.get(key);
    if (!channel) {
      channel = {
        sockets: new Map(),
        // Seeded from the clock, not zero: after an API restart the new
        // numbers are still above any `lastSeq` a browser kept, so its
        // catch-up request returns the new buffer instead of skipping it.
        seq: Date.now(),
        buffer: [],
        seen: new Map(),
      };
      this.channels.set(key, channel);
    }
    return channel;
  }

  /**
   * Number an event, remember it, and hand it to every socket on the
   * conversation — minus the one that caused it, for `user_message`.
   */
  private route(
    channel: IClientChannel,
    data: Record<string, unknown>,
    exceptSocketId?: string,
  ): void {
    const now = Date.now();
    const event: IBufferedEvent['event'] = { ...data, seq: ++channel.seq };
    // A `stream` frame carries the whole text so far, so only the newest one
    // per message is worth replaying — keeping them all would fill the buffer
    // with every intermediate state of one long answer.
    if (data.type === 'stream' && typeof data.messageId === 'string') {
      channel.buffer = channel.buffer.filter(
        (b) =>
          !(b.event.type === 'stream' && b.event.messageId === data.messageId),
      );
    }
    channel.buffer.push({ at: now, event });
    while (
      channel.buffer.length > REPLAY_MAX_EVENTS ||
      (channel.buffer.length > 0 &&
        now - channel.buffer[0].at > REPLAY_MAX_AGE_MS)
    ) {
      channel.buffer.shift();
    }
    for (const socket of channel.sockets.values()) {
      if (socket.socketId !== exceptSocketId) socket.send(event);
    }
  }

  replaySince(clientId: string, agentId: string, lastSeq: number): unknown[] {
    const channel = this.channels.get(this.clientKey(clientId, agentId));
    if (!channel) return [];
    const cutoff = Date.now() - REPLAY_MAX_AGE_MS;
    return channel.buffer
      .filter((b) => b.at >= cutoff && b.event.seq > lastSeq)
      .map((b) => b.event);
  }

  currentSeq(clientId: string, agentId: string): number {
    return this.channels.get(this.clientKey(clientId, agentId))?.seq ?? 0;
  }

  /**
   * Turns in flight, keyed like `channels`. Written from the thinking events
   * the hub already relays, so the API can drop a step of its own into the
   * timeline a person is watching (CLEAN-74) instead of minting a turnId that
   * would close the runtime's own block in every console.
   */
  private activeTurns = new Map<string, IActiveTurn & { agentId: string }>();

  /** Pending sync requests awaiting agent ack: requestId → pending */
  private pendingSyncs = new Map<string, IPendingSync>();

  /** Connect/disconnect events for AgentStatusService to reconcile DB status. */
  private readonly agentEvents = new Subject<IBridleAgentEvent>();

  registerAgent(
    agentId: string,
    socketId: string,
    send: (data: unknown) => void,
  ): void {
    this.agents.set(agentId, { socketId, send, connectedAt: Date.now() });
    this.logger.log(
      `Agent registered: agentId=${agentId} socket=${socketId} (total agents: ${this.agents.size})`,
    );
    this.broadcastAgentStatus(agentId, true);
    this.agentEvents.next({ type: 'connected', agentId });
  }

  unregisterAgent(agentId: string, socketId: string): void {
    const current = this.agents.get(agentId);
    if (!current) return;
    if (current.socketId !== socketId) {
      // A stale socket (usually the old pod's, detected late via ping
      // timeout) is disconnecting after a newer registration took over.
      // The live registration must survive.
      this.logger.log(
        `Ignoring stale disconnect for agentId=${agentId}: socket=${socketId} is not the current owner (${current.socketId})`,
      );
      return;
    }
    this.agents.delete(agentId);
    this.logger.warn(
      `Agent unregistered: agentId=${agentId} (total agents: ${this.agents.size})`,
    );
    // Cancel any pending sync requests for this agent — agent dropped before acking
    for (const [requestId, pending] of this.pendingSyncs) {
      if (pending.agentId !== agentId) continue;
      clearTimeout(pending.timer);
      this.pendingSyncs.delete(requestId);
      pending.reject(new Error('Agent disconnected before sync completed'));
    }
    this.broadcastAgentStatus(agentId, false);
    this.agentEvents.next({ type: 'disconnected', agentId });
  }

  isAgentSocket(agentId: string, socketId: string): boolean {
    return this.agents.get(agentId)?.socketId === socketId;
  }

  agentEvents$(): Observable<IBridleAgentEvent> {
    return this.agentEvents.asObservable();
  }

  /**
   * Push current agent connection state to every browser client scoped to
   * this agentId. Used so the chat header can show green (both chat and
   * agent connected) vs orange (one side down) without polling.
   */
  private broadcastAgentStatus(agentId: string, connected: boolean): void {
    for (const client of this.sockets()) {
      if (client.agentId !== agentId) continue;
      client.send({ type: 'agent_status', agentId, connected });
    }
  }

  isAgentConnected(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  agentConnectedSince(agentId: string): number | null {
    return this.agents.get(agentId)?.connectedAt ?? null;
  }

  registerClient(
    clientId: string,
    agentId: string,
    socketId: string,
    send: (data: unknown) => void,
    isAdmin: boolean,
    prompt?: string,
    capabilities?: string[],
    user?: IBridleUserIdentity,
  ): void {
    const channel = this.channelFor(clientId, agentId);
    if (channel.idleTimer) {
      clearTimeout(channel.idleTimer);
      channel.idleTimer = undefined;
    }
    channel.sockets.set(socketId, {
      clientId,
      agentId,
      socketId,
      send,
      isAdmin,
      ...(prompt ? { prompt } : {}),
      ...(capabilities && capabilities.length ? { capabilities } : {}),
      // Per socket, not per conversation: two admins share `admin` but each
      // sits on their own socket, so the identity follows the sender.
      ...(user?.id ? { user } : {}),
    });
    this.logger.log(
      `Browser client registered: ${clientId} agentId=${agentId} socket=${socketId} admin=${isAdmin}${capabilities?.length ? ` caps=[${capabilities.join(',')}]` : ''} (sockets on this conversation: ${channel.sockets.size})`,
    );
  }

  unregisterClient(clientId: string, agentId: string, socketId: string): void {
    const key = this.clientKey(clientId, agentId);
    const channel = this.channels.get(key);
    // Removing by socket id is what makes a stale/blackholed connection's late
    // disconnect harmless: it can only ever remove itself.
    if (!channel?.sockets.delete(socketId)) return;
    this.logger.log(
      `Browser client unregistered: ${clientId} agentId=${agentId} socket=${socketId} (sockets left: ${channel.sockets.size})`,
    );
    if (channel.sockets.size > 0) return;

    this.activeTurns.delete(key);
    // Keep the numbering and the buffer for a while — the usual reason for an
    // empty conversation is a page that is about to reconnect.
    channel.idleTimer = setTimeout(() => {
      if (channel.sockets.size === 0) this.channels.delete(key);
    }, CHANNEL_IDLE_MS);
    channel.idleTimer.unref?.();
  }

  sendToAgent(
    clientId: string,
    agentId: string,
    text: string,
    parts: BridlePart[],
    attachments?: IBridleAttachment[],
    options: IBridleSendOptions = {},
  ): BridleSendResult {
    const channel = this.channelFor(clientId, agentId);
    const now = Date.now();

    // A resend of something already handed over (the ack was lost, not the
    // message) must not make the agent answer twice.
    const { clientMessageId } = options;
    if (clientMessageId) {
      const acceptedAt = channel.seen.get(clientMessageId);
      if (acceptedAt !== undefined && now - acceptedAt < SEEN_TTL_MS) {
        return {
          status: 'accepted',
          messageId: clientMessageId,
          ts: acceptedAt,
          duplicate: true,
        };
      }
    }

    const agentSend = this.agents.get(agentId)?.send;
    if (!agentSend) {
      this.logger.warn(
        `Cannot send to agent — not connected (agentId=${agentId})`,
      );
      // A caller that asked for an acknowledgement is told the truth and shows
      // it under the person's own message. Everyone else (embed widget, older
      // bundles) keeps the sentence they have always rendered as a reply.
      if (!options.withAck) {
        this.sendToClient(clientId, agentId, {
          type: 'message',
          text: 'Agent is not connected. Please try again later.',
          parts: [
            {
              type: 'text',
              text: 'Agent is not connected. Please try again later.',
            },
          ],
          messageId: randomUUID(),
          ts: now,
        });
      }
      return { status: 'rejected', code: 'AGENT_OFFLINE' };
    }

    // The browser's own id travels end to end when it sent one, so the bubble
    // on screen, the message the agent gets and (once the runtime stores it)
    // the transcript entry are one and the same message.
    const messageId = clientMessageId ?? randomUUID();
    const client =
      (options.socketId && channel.sockets.get(options.socketId)) ||
      channel.sockets.values().next().value;
    agentSend({
      type: 'message',
      clientId,
      text,
      parts,
      ...(client?.prompt ? { prompt: client.prompt } : {}),
      ...(client?.capabilities?.length
        ? { capabilities: client.capabilities }
        : {}),
      ...(client?.user ? { user: client.user } : {}),
      // Metadata only: the runtime persists this array verbatim into its
      // session transcript. The url is this API's own route (useless to the
      // runtime) and readableByAgent is a UI concern — neither belongs in
      // every future replay.
      ...(attachments?.length
        ? {
            attachments: attachments.map((a) => ({
              id: a.id,
              name: a.name,
              mimeType: a.mimeType,
              size: a.size,
              kind: a.kind,
            })),
          }
        : {}),
      messageId,
    });

    if (clientMessageId) {
      channel.seen.set(clientMessageId, now);
      for (const [id, at] of channel.seen) {
        if (channel.seen.size <= SEEN_MAX && now - at < SEEN_TTL_MS) break;
        channel.seen.delete(id);
      }
    }

    // The other places this conversation is open get the question too —
    // otherwise they would show an answer to something nobody asked there.
    this.route(
      channel,
      {
        type: 'user_message',
        messageId,
        text: options.displayText ?? text,
        ...(attachments?.length
          ? {
              attachments: attachments.map((a) => ({
                id: a.id,
                name: a.name,
                mimeType: a.mimeType,
                size: a.size,
                kind: a.kind,
              })),
            }
          : {}),
        ts: now,
      },
      options.socketId,
    );

    return { status: 'accepted', messageId, ts: now };
  }

  sendToClient(clientId: string, agentId: string, data: unknown): void {
    const channel = this.channels.get(this.clientKey(clientId, agentId));
    if (channel) this.route(channel, data as Record<string, unknown>);
  }

  handleAgentEvent(agentId: string, data: IBridleOutgoingEvent): void {
    const clientId = data.clientId;
    if (!clientId) return;

    if (data.type === 'thinking') {
      this.trackTurn(agentId, clientId, data);
    }

    // No socket right now is not a reason to drop the event: `route` keeps it
    // for the reconnect. An identity the hub has never seen gets nothing.
    const channel = this.channels.get(this.clientKey(clientId, agentId));
    if (channel) this.route(channel, { ...data });
  }

  /** A step opens or refreshes the turn; the terminal `done` closes it. */
  private trackTurn(
    agentId: string,
    clientId: string,
    data: IBridleOutgoingEvent,
  ): void {
    const key = this.clientKey(clientId, agentId);
    if (data.done === true || typeof data.turnId !== 'string') {
      this.activeTurns.delete(key);
      return;
    }
    this.activeTurns.set(key, {
      agentId,
      clientId,
      turnId: data.turnId,
      ts: typeof data.ts === 'number' ? data.ts : Date.now(),
    });
  }

  findActiveTurn(agentId: string): IActiveTurn | null {
    let newest: (IActiveTurn & { agentId: string }) | null = null;
    for (const turn of this.activeTurns.values()) {
      if (turn.agentId !== agentId) continue;
      if (!newest || turn.ts > newest.ts) newest = turn;
    }
    if (!newest) return null;
    return { clientId: newest.clientId, turnId: newest.turnId, ts: newest.ts };
  }

  setDebug(agentId: string, enabled: boolean): void {
    const agentSend = this.agents.get(agentId)?.send;
    if (!agentSend) {
      this.logger.debug(
        `setDebug skipped: agent not connected for agentId=${agentId}`,
      );
      return;
    }
    agentSend({ type: 'debug_set', enabled });
    this.logger.log(`Pushed debug_set=${enabled} to agent agentId=${agentId}`);
  }

  notifyMcpConnected(
    agentId: string,
    event: Omit<IBridleMcpConnectedEvent, 'type'>,
  ): void {
    const agentSend = this.agents.get(agentId)?.send;
    if (!agentSend) {
      this.logger.debug(
        `mcp_connected skipped: agent not connected for agentId=${agentId}`,
      );
      return;
    }
    const payload: IBridleMcpConnectedEvent = { type: 'mcp_connected', ...event };
    agentSend(payload);
    this.logger.log(
      `Pushed mcp_connected server=${event.server} subject=${event.subject} to agent agentId=${agentId}`,
    );
  }

  clearAgentSession(agentId: string, channel: string): void {
    const agentSend = this.agents.get(agentId)?.send;
    if (!agentSend) {
      this.logger.debug(
        `clearAgentSession skipped: agent not connected for agentId=${agentId}, channel=${channel}`,
      );
      return;
    }
    agentSend({ type: 'session_clear', channel });
    this.logger.log(
      `Pushed session_clear for channel=${channel} to agent agentId=${agentId}`,
    );
  }

  handleDebugEvent(agentId: string, data: IBridleDebugEvent): void {
    // Admin-only fan-out. We ignore data.clientId on purpose: the runtime
    // only knows the immediate sender, but multiple admins may be observing
    // the same agent and they all want to see prompt traces.
    let delivered = 0;
    for (const client of this.sockets()) {
      if (client.agentId !== agentId) continue;
      if (!client.isAdmin) continue;
      client.send(data);
      delivered++;
    }
    if (delivered === 0) {
      this.logger.debug(
        `Debug event dropped: no admin clients for agentId=${agentId}`,
      );
    }
  }

  health(): IBridleHealthData {
    return {
      ok: true,
      agentConnected: this.agents.size > 0,
      browserClients: [...this.sockets()].length,
    };
  }

  agentHealth(agentId: string): IBridleAgentHealthData {
    let clientCount = 0;
    for (const client of this.sockets()) {
      if (client.agentId === agentId) clientCount++;
    }
    return {
      ok: true,
      agentConnected: this.agents.has(agentId),
      browserClients: clientCount,
      agentId,
    };
  }

  syncAgent(
    agentId: string,
    timeoutMs: number = DEFAULT_SYNC_TIMEOUT_MS,
  ): Promise<ISyncAgentResult> {
    const agentSend = this.agents.get(agentId)?.send;
    if (!agentSend) {
      return Promise.resolve({ agentOnline: false, pushed: 0 });
    }

    const requestId = randomUUID();
    return new Promise<ISyncAgentResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingSyncs.delete(requestId);
        reject(
          new Error(`Sync timed out after ${timeoutMs}ms (agentId=${agentId})`),
        );
      }, timeoutMs);

      this.pendingSyncs.set(requestId, { resolve, reject, timer, agentId });
      agentSend({ type: 'sync', requestId });
    });
  }

  handleSyncResponse(agentId: string, data: IBridleSyncResponse): void {
    const pending = this.pendingSyncs.get(data.requestId);
    if (!pending) {
      this.logger.warn(
        `Got sync_done for unknown requestId=${data.requestId} agentId=${agentId}`,
      );
      return;
    }
    clearTimeout(pending.timer);
    this.pendingSyncs.delete(data.requestId);
    if (data.error) {
      pending.reject(new Error(data.error));
    } else {
      pending.resolve({ agentOnline: true, pushed: data.pushed ?? 0 });
    }
  }

  listAgents(): Array<{ agentId: string; clients: number }> {
    const result: Array<{ agentId: string; clients: number }> = [];
    for (const agentId of this.agents.keys()) {
      let clients = 0;
      for (const c of this.sockets()) {
        if (c.agentId === agentId) clients++;
      }
      result.push({ agentId, clients });
    }
    return result;
  }
}
