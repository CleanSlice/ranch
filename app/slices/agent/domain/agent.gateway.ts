import type {
  IAgentCreateInput,
  IAgentData,
  IAgentLinkData,
  IAgentUpdateInput,
  IClusterCapacityData,
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
  abstract stop(id: string): Promise<IAgentData | null>;
  abstract start(id: string): Promise<IAgentData | null>;
  abstract getCapacity(): Promise<IClusterCapacityData | null>;
  abstract getLinks(): Promise<IAgentLinkData[]>;
  /**
   * Whether the agent has at least one request limit (CLEAN-224). The one
   * fact about limits this console is given: the numbers, the usage and the
   * form live in the admin console. Null when the API gave no answer.
   */
  abstract getLimitsEnabled(id: string): Promise<boolean | null>;
}
