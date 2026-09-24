import type { Observable } from 'rxjs';
import type {
  IBridleHealthData,
  IBridleAgentHealthData,
  IBridleOutgoingEvent,
  IBridleSyncResponse,
  IBridleDebugEvent,
  BridlePart,
  IBridleAttachment,
  IActiveTurn,
  IBridleSendOptions,
  BridleSendResult,
  IBridleUserIdentity,
  IBridleMcpConnectedEvent,
} from './bridle.types';

export interface ISyncAgentResult {
  agentOnline: boolean;
  pushed: number;
}

export interface IBridleAgentEvent {
  type: 'connected' | 'disconnected';
  agentId: string;
}

/**
 * Hub gateway — manages per-agent connections from agents and browser clients.
 * Routes messages between them, scoped by agentId.
 */
export abstract class IBridleGateway {
  /** Send a message from a browser client to the agent for a specific agent.
   * `attachments` are the stored-file references behind any image/file parts —
   * the runtime persists them into its session transcript so replays can
   * re-link the files (only metadata crosses the wire, never bytes). */
  abstract sendToAgent(
    clientId: string,
    agentId: string,
    text: string,
    parts: BridlePart[],
    attachments?: IBridleAttachment[],
    options?: IBridleSendOptions,
  ): BridleSendResult;
  /** Send an event to every socket open on this conversation (clientId +
   * agentId), numbered and kept for replay like the agent's own events. */
  abstract sendToClient(clientId: string, agentId: string, data: unknown): void;
  /**
   * Hand an event to every browser conversation of `agentId` (CLEAN-112:
   * `proposal_update` must flip the card in every open tab). Only sockets
   * that declared `capability` at handshake receive it when one is given.
   */
  abstract sendToAgentClients(
    agentId: string,
    data: unknown,
    capability?: string,
  ): void;
  /**
   * Events routed to this conversation after `lastSeq`, oldest first — what a
   * browser missed while it was reconnecting. Empty when nothing is buffered
   * or the conversation is unknown.
   */
  abstract replaySince(
    clientId: string,
    agentId: string,
    lastSeq: number,
  ): unknown[];
  /** Last sequence number issued for this conversation; 0 when unknown. */
  abstract currentSeq(clientId: string, agentId: string): number;
  /** Register a browser socket on a conversation. Several sockets may share
   * one clientId+agentId — they all receive its events; `socketId` tells them
   * apart so each one can only ever unregister itself. */
  abstract registerClient(
    clientId: string,
    agentId: string,
    socketId: string,
    send: (data: unknown) => void,
    isAdmin: boolean,
    /** Integrator context from the embed's `data-prompt`; forwarded to the
     * agent on every message in this session. */
    prompt?: string,
    /** Handshake-advertised render capabilities; forwarded to the agent on
     * every message so runtimes can gate `thinking`/`ui` emission. */
    capabilities?: string[],
    /** The console login behind this socket (JWT `sub` + email); forwarded
     * on every message it sends so a runtime can keep per-person state
     * (CLEAN-80). Absent for share visitors and anonymous embeds. */
    user?: IBridleUserIdentity,
  ): void;
  /** Unregister one browser socket. The conversation's other sockets are
   * untouched; its numbering and replay buffer outlive the last one for a
   * while so a reconnect can catch up. */
  abstract unregisterClient(
    clientId: string,
    agentId: string,
    socketId: string,
  ): void;
  /** Register an agent connection for a specific agent. `socketId` marks the
   * owning socket so a stale connection's late disconnect can't wipe a newer
   * registration for the same agentId. */
  abstract registerAgent(
    agentId: string,
    socketId: string,
    send: (data: unknown) => void,
  ): void;
  /** Unregister an agent connection — no-op unless `socketId` still owns the
   * current registration. */
  abstract unregisterAgent(agentId: string, socketId: string): void;
  /** Whether this exact socket owns the current registration for agentId. */
  abstract isAgentSocket(agentId: string, socketId: string): boolean;
  /** Handle an event from the agent — route to the target browser client for that agent */
  abstract handleAgentEvent(agentId: string, data: IBridleOutgoingEvent): void;
  /**
   * Handle a debug snapshot from the agent — fan out to admin clients of this
   * agent only. Non-admin clients never see this event.
   */
  abstract handleDebugEvent(agentId: string, data: IBridleDebugEvent): void;
  /** Health status (all agents) */
  abstract health(): IBridleHealthData;
  /** Health status for a specific agent */
  abstract agentHealth(agentId: string): IBridleAgentHealthData;
  /** Whether an agent runtime is currently registered for this agentId. */
  abstract isAgentConnected(agentId: string): boolean;
  /**
   * When the currently registered runtime for agentId joined the hub (epoch
   * ms), or null when none is. "Connected" alone cannot tell the instance a
   * restart is replacing from the one it is bringing up — for several seconds
   * after a restart begins the OLD runtime is still the one on the hub
   * (CLEAN-106).
   */
  abstract agentConnectedSince(agentId: string): number | null;
  /**
   * Observable stream of agent connect/disconnect events. Consumed by
   * AgentStatusService to flip the DB status the moment a runtime registers
   * (faster + more reliable than the K8s readiness probe — runtime connects
   * to bridle inside `runtime.start()`, before Bun.serve binds port 3000).
   */
  abstract agentEvents$(): Observable<IBridleAgentEvent>;
  /** List all connected agents with their client counts */
  abstract listAgents(): Array<{ agentId: string; clients: number }>;
  /**
   * Ask the agent for agentId to push its local .agent/ directory to S3 and
   * resolve when the agent acks. Resolves with `agentOnline=false` immediately
   * if no agent is connected for agentId.
   */
  abstract syncAgent(
    agentId: string,
    timeoutMs?: number,
  ): Promise<ISyncAgentResult>;
  /** Resolve a pending syncAgent() Promise by requestId. */
  abstract handleSyncResponse(agentId: string, data: IBridleSyncResponse): void;
  /**
   * Push a debug-enable/disable command to the running agent. Silently
   * skipped if the agent for agentId isn't currently connected — the new
   * value will be re-sent on the next agent register handshake.
   */
  abstract setDebug(agentId: string, enabled: boolean): void;
  /**
   * Wake a running agent right after an MCP server's OAuth "Connect" flow
   * completes (CLEAN-75), so it brings up that MCP immediately instead of only
   * on the next boot. Silently skipped if the agent isn't currently connected —
   * the token is already persisted as a secret, so a fresh boot picks it up.
   */
  abstract notifyMcpConnected(
    agentId: string,
    event: Omit<IBridleMcpConnectedEvent, 'type'>,
  ): void;
  /**
   * The turn this agent is in the middle of, for the client that is watching
   * it — or null when nothing is known. Lets API-side code (CLEAN-74) add a
   * step to a timeline the runtime opened, instead of inventing a turn of its
   * own: a step under an unknown turnId would close the runtime's block in
   * every console that renders thinking.
   *
   * Derived purely from the thinking events already passing through the hub,
   * so it costs nothing and stays correct without the runtime knowing. With
   * two people chatting to one agent at once, the most recent turn wins —
   * a tool call carries no clue which conversation it belongs to.
   */
  abstract findActiveTurn(agentId: string): IActiveTurn | null;
  /**
   * Tell the running agent to drop its local copy of a session (file +
   * in-memory cache) for the given bridle channel. Sent after the transcript
   * for that channel has been archived/deleted server-side — without this,
   * the agent's own S3 watcher would re-upload its still-intact local
   * session file on the next local change, resurrecting the "deleted"
   * history. Silently skipped if the agent isn't currently connected (there
   * is then no live local file to worry about).
   */
  abstract clearAgentSession(agentId: string, channel: string): void;
}
