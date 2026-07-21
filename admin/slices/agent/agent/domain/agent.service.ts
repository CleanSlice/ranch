import type { IAgentGateway } from './agent.gateway';
import type {
  IAgentData,
  IAgentEnvVar,
  IAgentMetrics,
  ICreateAgentData,
  IUpdateAgentData,
} from './agent.types';

/**
 * Domain service for admin agent management. Exposes the CRUD + lifecycle
 * (restart/stop/start) + introspection (logs/env/metrics) use-cases; the store
 * layers the reactive agent list, optimistic status flips, and the localStorage
 * restart flags on top.
 */
export class AgentService {
  constructor(private gateway: IAgentGateway) {}

  findAll(): Promise<IAgentData[]> {
    return this.gateway.findAll();
  }

  findById(id: string): Promise<IAgentData | null> {
    return this.gateway.findById(id);
  }

  findAdmin(): Promise<IAgentData | null> {
    return this.gateway.findAdmin();
  }

  create(input: ICreateAgentData): Promise<IAgentData> {
    return this.gateway.create(input);
  }

  update(id: string, input: IUpdateAgentData): Promise<IAgentData> {
    return this.gateway.update(id, input);
  }

  restart(id: string): Promise<IAgentData> {
    return this.gateway.restart(id);
  }

  stop(id: string): Promise<IAgentData> {
    return this.gateway.stop(id);
  }

  start(id: string): Promise<IAgentData> {
    return this.gateway.start(id);
  }

  remove(id: string, wipeS3: boolean): Promise<void> {
    return this.gateway.remove(id, wipeS3);
  }

  promoteAdmin(id: string): Promise<IAgentData> {
    return this.gateway.promoteAdmin(id);
  }

  demoteAdmin(id: string): Promise<IAgentData> {
    return this.gateway.demoteAdmin(id);
  }

  logs(id: string): Promise<string> {
    return this.gateway.logs(id);
  }

  env(id: string): Promise<IAgentEnvVar[]> {
    return this.gateway.env(id);
  }

  metrics(id: string): Promise<IAgentMetrics | null> {
    return this.gateway.metrics(id);
  }
}
