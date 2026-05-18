import type { Observable } from 'rxjs';
import type {
  IBridleHealthData,
  IBridleAgentHealthData,
  IBridleOutgoingEvent,
  IBridleSyncResponse,
  IBridleDebugEvent,
  BridlePart,
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
  /** Send a message from a browser client to the agent for a specific agent */
  abstract sendToAgent(
    clientId: string,
    agentId: string,
    text: string,
    parts: BridlePart[],
  ): void;
  /** Send an event to a specific browser client */
  abstract sendToClient(clientId: string, data: unknown): void;
  /** Register a browser client for a specific agent */
  abstract registerClient(
    clientId: string,
    agentId: string,
    send: (data: unknown) => void,
    isAdmin: boolean,
  ): void;
  /** Unregister a browser client */
  abstract unregisterClient(clientId: string): void;
  /** Register an agent connection for a specific agent */
  abstract registerAgent(agentId: string, send: (data: unknown) => void): void;
  /** Unregister an agent connection for a specific agent */
  abstract unregisterAgent(agentId: string): void;
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
}
