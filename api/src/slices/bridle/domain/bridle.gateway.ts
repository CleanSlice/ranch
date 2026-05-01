import type {
  IBridleHealthData,
  IBridleBotHealthData,
  IBridleOutgoingEvent,
  IBridleSyncResponse,
  IBridleDebugEvent,
  BridlePart,
} from './bridle.types';

export interface ISyncAgentResult {
  agentOnline: boolean;
  pushed: number;
}

/**
 * Hub gateway — manages per-bot connections from agents and browser clients.
 * Routes messages between them, scoped by botId.
 */
export abstract class IBridleGateway {
  /** Send a message from a browser client to the agent for a specific bot */
  abstract sendToAgent(
    clientId: string,
    botId: string,
    text: string,
    parts: BridlePart[],
  ): void;
  /** Send an event to a specific browser client */
  abstract sendToClient(clientId: string, data: unknown): void;
  /** Register a browser client for a specific bot */
  abstract registerClient(
    clientId: string,
    botId: string,
    send: (data: unknown) => void,
    isAdmin: boolean,
  ): void;
  /** Unregister a browser client */
  abstract unregisterClient(clientId: string): void;
  /** Register an agent connection for a specific bot */
  abstract registerAgent(botId: string, send: (data: unknown) => void): void;
  /** Unregister an agent connection for a specific bot */
  abstract unregisterAgent(botId: string): void;
  /** Handle an event from the agent — route to the target browser client for that bot */
  abstract handleAgentEvent(botId: string, data: IBridleOutgoingEvent): void;
  /**
   * Handle a debug snapshot from the agent — fan out to admin clients of this
   * bot only. Non-admin clients never see this event.
   */
  abstract handleDebugEvent(botId: string, data: IBridleDebugEvent): void;
  /** Health status (all bots) */
  abstract health(): IBridleHealthData;
  /** Health status for a specific bot */
  abstract botHealth(botId: string): IBridleBotHealthData;
  /** List all connected agents with their client counts */
  abstract listAgents(): Array<{ botId: string; clients: number }>;
  /**
   * Ask the agent for botId to push its local .agent/ directory to S3 and
   * resolve when the agent acks. Resolves with `agentOnline=false` immediately
   * if no agent is connected for botId.
   */
  abstract syncAgent(botId: string, timeoutMs?: number): Promise<ISyncAgentResult>;
  /** Resolve a pending syncAgent() Promise by requestId. */
  abstract handleSyncResponse(botId: string, data: IBridleSyncResponse): void;
  /**
   * Push a debug-enable/disable command to the running agent. Silently
   * skipped if the agent for botId isn't currently connected — the new
   * value will be re-sent on the next agent register handshake.
   */
  abstract setDebug(botId: string, enabled: boolean): void;
}
