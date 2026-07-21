import type { IMcpServerGateway } from './mcpServer.gateway';
import type {
  ICreateMcpServerData,
  IMcpServerData,
  IUpdateMcpServerData,
} from './mcpServer.types';

/** Domain service for MCP servers. The store layers the reactive list. */
export class McpServerService {
  constructor(private gateway: IMcpServerGateway) {}

  findAll(): Promise<IMcpServerData[]> {
    return this.gateway.findAll();
  }

  findById(id: string): Promise<IMcpServerData | null> {
    return this.gateway.findById(id);
  }

  create(input: ICreateMcpServerData): Promise<IMcpServerData> {
    return this.gateway.create(input);
  }

  update(id: string, input: IUpdateMcpServerData): Promise<IMcpServerData> {
    return this.gateway.update(id, input);
  }

  remove(id: string): Promise<void> {
    return this.gateway.remove(id);
  }
}
