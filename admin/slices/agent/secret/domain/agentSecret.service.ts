import type { IAgentSecretGateway } from './agentSecret.gateway';
import type { ISecretListData } from './agentSecret.types';

/**
 * Domain service for an agent's secrets. The store layers reactive
 * data/loading/error state on top.
 */
export class AgentSecretService {
  constructor(private gateway: IAgentSecretGateway) {}

  list(agentId: string): Promise<ISecretListData | null> {
    return this.gateway.list(agentId);
  }

  set(agentId: string, key: string, value: string): Promise<ISecretListData> {
    return this.gateway.set(agentId, key, value);
  }

  remove(agentId: string, key: string): Promise<ISecretListData> {
    return this.gateway.remove(agentId, key);
  }

  replaceAll(
    agentId: string,
    store: Record<string, string>,
  ): Promise<ISecretListData> {
    return this.gateway.replaceAll(agentId, store);
  }
}
