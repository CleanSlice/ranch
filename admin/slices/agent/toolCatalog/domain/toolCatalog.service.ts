import type { IAgentToolCatalog, IToolCatalogGateway } from './toolCatalog.types';

/** Pass-through to the gateway, in the slice shape the console uses everywhere. */
export class ToolCatalogService {
  constructor(private readonly gateway: IToolCatalogGateway) {}

  forAgent(agentId: string): Promise<IAgentToolCatalog> {
    return this.gateway.forAgent(agentId);
  }
}
