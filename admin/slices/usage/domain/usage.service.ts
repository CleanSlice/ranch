import type { IUsageGateway } from './usage.gateway';
import type { IAgentUsage } from './usage.types';

/** Domain service for per-agent usage. The store layers a per-agent cache. */
export class UsageService {
  constructor(private gateway: IUsageGateway) {}

  findForAgent(agentId: string): Promise<IAgentUsage | null> {
    return this.gateway.findForAgent(agentId);
  }
}
