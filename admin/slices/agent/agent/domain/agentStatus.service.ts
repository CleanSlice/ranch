import type { IAgentStatusGateway } from './agentStatus.gateway';
import type { IAgentStatusCallbacks } from './agentStatus.types';

/**
 * Domain service for the live agent-status stream. Thin today (forwards to the
 * gateway); cross-cutting concerns (reconnect policy, multiplexing) would land
 * here without touching the store.
 */
export class AgentStatusService {
  constructor(private gateway: IAgentStatusGateway) {}

  subscribe(callbacks: IAgentStatusCallbacks): void {
    this.gateway.subscribe(callbacks);
  }

  unsubscribe(): void {
    this.gateway.unsubscribe();
  }
}
