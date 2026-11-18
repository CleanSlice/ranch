import type { IAgentAccessData, ISetAgentAccessInput } from './agentAccess.types';

/** Contract for the agent access API. Implemented by `AgentAccessGateway`. */
export abstract class IAgentAccessGateway {
  abstract get(userId: string): Promise<IAgentAccessData>;
  abstract set(userId: string, input: ISetAgentAccessInput): Promise<IAgentAccessData>;
}
