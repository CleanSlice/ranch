import type {
  IBridleHealthData,
  IBridleBotHealthData,
  IBridleOutgoingEvent,
  BridlePart,
} from './bridle.types';

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
  ): void;
  /** Unregister a browser client */
  abstract unregisterClient(clientId: string): void;
  /** Register an agent connection for a specific bot */
  abstract registerAgent(botId: string, send: (data: unknown) => void): void;
  /** Unregister an agent connection for a specific bot */
  abstract unregisterAgent(botId: string): void;
  /** Handle an event from the agent — route to the target browser client for that bot */
  abstract handleAgentEvent(botId: string, data: IBridleOutgoingEvent): void;
  /** Health status (all bots) */
  abstract health(): IBridleHealthData;
  /** Health status for a specific bot */
  abstract botHealth(botId: string): IBridleBotHealthData;
  /** List all connected agents with their client counts */
  abstract listAgents(): Array<{ botId: string; clients: number }>;
}
