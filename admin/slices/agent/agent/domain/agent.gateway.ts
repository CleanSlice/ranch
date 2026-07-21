import type {
  IAgentData,
  IAgentEnvVar,
  IAgentMetrics,
  ICreateAgentData,
  IUpdateAgentData,
} from './agent.types';

/**
 * Contract for the admin agents API. Implemented by `AgentGateway` in the data
 * layer, which hides the mixed transport (generated SDK + raw axios for
 * not-yet-typed endpoints + raw fetch for the wipeS3 delete). The service and
 * store depend only on this abstraction.
 */
export abstract class IAgentGateway {
  abstract findAll(): Promise<IAgentData[]>;
  abstract findById(id: string): Promise<IAgentData | null>;
  abstract findAdmin(): Promise<IAgentData | null>;
  abstract create(input: ICreateAgentData): Promise<IAgentData>;
  abstract update(id: string, input: IUpdateAgentData): Promise<IAgentData>;
  abstract restart(id: string): Promise<IAgentData>;
  abstract stop(id: string): Promise<IAgentData>;
  abstract start(id: string): Promise<IAgentData>;
  abstract remove(id: string, wipeS3: boolean): Promise<void>;
  abstract promoteAdmin(id: string): Promise<IAgentData>;
  abstract demoteAdmin(id: string): Promise<IAgentData>;
  abstract logs(id: string): Promise<string>;
  abstract env(id: string): Promise<IAgentEnvVar[]>;
  abstract metrics(id: string): Promise<IAgentMetrics | null>;
}
