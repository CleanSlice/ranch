import type {
  ICreateMcpServerData,
  IMcpServerData,
  IUpdateMcpServerData,
} from './mcpServer.types';

/** Contract for the MCP servers API. Implemented by `McpServerGateway`. */
export abstract class IMcpServerGateway {
  abstract findAll(): Promise<IMcpServerData[]>;
  abstract findById(id: string): Promise<IMcpServerData | null>;
  abstract create(input: ICreateMcpServerData): Promise<IMcpServerData>;
  abstract update(
    id: string,
    input: IUpdateMcpServerData,
  ): Promise<IMcpServerData>;
  abstract remove(id: string): Promise<void>;
}
