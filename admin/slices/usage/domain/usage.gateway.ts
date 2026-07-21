import type { IAgentUsage } from './usage.types';

/** Contract for per-agent usage. Implemented by `UsageGateway`. */
export abstract class IUsageGateway {
  abstract findForAgent(agentId: string): Promise<IAgentUsage | null>;
}
