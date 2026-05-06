import {
  IAgentData,
  ICreateAgentData,
  IUpdateAgentData,
  AgentStatusTypes,
} from './agent.types';

export abstract class IAgentGateway {
  abstract findAll(): Promise<IAgentData[]>;
  abstract findPublic(): Promise<IAgentData[]>;
  abstract findAdmin(): Promise<IAgentData | null>;
  abstract findById(id: string): Promise<IAgentData | null>;
  abstract create(data: ICreateAgentData): Promise<IAgentData>;
  abstract update(id: string, data: IUpdateAgentData): Promise<IAgentData>;
  abstract updateStatus(
    id: string,
    status: AgentStatusTypes,
    workflowId?: string,
  ): Promise<IAgentData>;
  abstract setWorkflowId(id: string, workflowId: string): Promise<IAgentData>;
  abstract setDebugEnabled(id: string, enabled: boolean): Promise<IAgentData>;
  abstract setAdmin(id: string, enabled: boolean): Promise<IAgentData>;
  abstract delete(id: string): Promise<void>;
}
