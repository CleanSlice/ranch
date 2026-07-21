import type { IAgentStatusCallbacks } from './agentStatus.types';

/**
 * Contract for the live agent-status stream. Implemented by `AgentStatusGateway`
 * in the data layer (which owns the EventSource). `subscribe` opens the stream
 * and drives the callbacks; `unsubscribe` tears it down.
 */
export abstract class IAgentStatusGateway {
  abstract subscribe(callbacks: IAgentStatusCallbacks): void;
  abstract unsubscribe(): void;
}
