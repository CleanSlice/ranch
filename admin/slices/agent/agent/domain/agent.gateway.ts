import type {
  IAgentData,
  IAgentEnvVar,
  IAgentLogSummary,
  IAgentMetrics,
  IClusterCapacityData,
  ICreateAgentData,
  IUpdateAgentData,
} from './agent.types';
import type { IAgentToolState } from './agentStatus.types';

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
  /**
   * Pin or unpin the agent for the signed-in account (CLEAN-231). Idempotent
   * on the server; throws when it refuses, so the store can roll back.
   */
  abstract setPinned(id: string, pinned: boolean): Promise<void>;
  abstract restart(id: string): Promise<IAgentData>;
  abstract stop(id: string): Promise<IAgentData>;
  abstract start(id: string): Promise<IAgentData>;
  abstract remove(id: string, wipeS3: boolean): Promise<void>;
  abstract promoteAdmin(id: string): Promise<IAgentData>;
  abstract demoteAdmin(id: string): Promise<IAgentData>;
  abstract logs(id: string): Promise<string>;
  abstract logSummary(id: string): Promise<IAgentLogSummary>;
  abstract env(id: string): Promise<IAgentEnvVar[]>;
  abstract metrics(id: string): Promise<IAgentMetrics | null>;
  /** What the runtime says of its tool servers; `null` when nothing is known. */
  abstract toolState(id: string): Promise<IAgentToolState | null>;
  abstract capacity(): Promise<IClusterCapacityData | null>;
}
