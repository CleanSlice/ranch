import {
  IAgentData,
  ICreateAgentData,
  IUpdateAgentData,
  AgentStatusTypes,
} from './agent.types';

export abstract class IAgentGateway {
  abstract findAll(): Promise<IAgentData[]>;
  abstract findById(id: string): Promise<IAgentData | null>;
  abstract create(data: ICreateAgentData): Promise<IAgentData>;
  abstract update(id: string, data: IUpdateAgentData): Promise<IAgentData>;
  abstract updateStatus(
    id: string,
    status: AgentStatusTypes,
    workflowId?: string,
  ): Promise<IAgentData>;
  abstract delete(id: string): Promise<void>;
}
