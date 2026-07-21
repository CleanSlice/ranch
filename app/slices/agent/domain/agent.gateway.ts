import type {
  IAgentCreateInput,
  IAgentData,
  IAgentUpdateInput,
} from './agent.types';

/**
 * Contract for the agents API. Implemented by `AgentGateway` in the data layer;
 * the service and store depend only on this abstraction.
 */
export abstract class IAgentGateway {
  abstract findAll(): Promise<IAgentData[]>;
  abstract findPublic(): Promise<IAgentData[]>;
  abstract findById(id: string): Promise<IAgentData | null>;
  abstract create(input: IAgentCreateInput): Promise<IAgentData | null>;
  abstract update(
    id: string,
    input: IAgentUpdateInput,
  ): Promise<IAgentData | null>;
  abstract remove(id: string): Promise<void>;
  abstract restart(id: string): Promise<IAgentData | null>;
}
