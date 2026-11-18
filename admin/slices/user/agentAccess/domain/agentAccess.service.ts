import type { IAgentAccessGateway } from './agentAccess.gateway';
import type { IAgentAccessData, ISetAgentAccessInput } from './agentAccess.types';

/** Domain service for agent access. The store keeps the record per account. */
export class AgentAccessService {
  constructor(private gateway: IAgentAccessGateway) {}

  get(userId: string): Promise<IAgentAccessData> {
    return this.gateway.get(userId);
  }

  set(userId: string, input: ISetAgentAccessInput): Promise<IAgentAccessData> {
    return this.gateway.set(userId, input);
  }
}
