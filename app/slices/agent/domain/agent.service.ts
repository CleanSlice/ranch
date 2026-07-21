import type { IAgentGateway } from './agent.gateway';
import type {
  IAgentCreateInput,
  IAgentData,
  IAgentUpdateInput,
} from './agent.types';

/**
 * Domain service for agents. Exposes the CRUD + restart use-cases; the store
 * layers reactive list/current state and loading/error flags on top.
 */
export class AgentService {
  constructor(private gateway: IAgentGateway) {}

  findAll(): Promise<IAgentData[]> {
    return this.gateway.findAll();
  }

  findPublic(): Promise<IAgentData[]> {
    return this.gateway.findPublic();
  }

  findById(id: string): Promise<IAgentData | null> {
    return this.gateway.findById(id);
  }

  create(input: IAgentCreateInput): Promise<IAgentData | null> {
    return this.gateway.create(input);
  }

  update(id: string, input: IAgentUpdateInput): Promise<IAgentData | null> {
    return this.gateway.update(id, input);
  }

  remove(id: string): Promise<void> {
    return this.gateway.remove(id);
  }

  restart(id: string): Promise<IAgentData | null> {
    return this.gateway.restart(id);
  }
}
