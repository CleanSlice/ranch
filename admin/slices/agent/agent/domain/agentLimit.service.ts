import type { IAgentLimitGateway } from './agentLimit.gateway';
import type {
  IAgentLimitSummary,
  IAgentLimits,
  IAgentLoad,
} from './agentLimit.types';

/**
 * Domain service for an agent's request limits and live load. The store layers
 * the per-agent record, the optimistic save and the two polls on top.
 */
export class AgentLimitService {
  constructor(private gateway: IAgentLimitGateway) {}

  summary(): Promise<IAgentLimitSummary[]> {
    return this.gateway.summary();
  }

  limits(agentId: string): Promise<IAgentLimits | null> {
    return this.gateway.limits(agentId);
  }

  setLimits(
    agentId: string,
    limits: IAgentLimits | null,
  ): Promise<IAgentLimits | null> {
    return this.gateway.setLimits(agentId, limits);
  }

  load(agentId: string): Promise<IAgentLoad> {
    return this.gateway.load(agentId);
  }
}
