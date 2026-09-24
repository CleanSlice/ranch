import {
  IMcpServerData,
  ICreateMcpServerData,
  IUpdateMcpServerData,
} from './mcpServer.types';

export abstract class IMcpServerGateway {
  abstract findAll(): Promise<IMcpServerData[]>;
  abstract findById(id: string): Promise<IMcpServerData | null>;
  abstract findByIds(ids: string[]): Promise<IMcpServerData[]>;
  abstract create(data: ICreateMcpServerData): Promise<IMcpServerData>;
  abstract update(
    id: string,
    data: IUpdateMcpServerData,
  ): Promise<IMcpServerData>;
  abstract delete(id: string): Promise<void>;
  /**
   * Remember the client id a dynamic OAuth registration handed back
   * (CLEAN-75), WITHOUT touching `updatedAt`. The id is not pod
   * configuration — MCP_SERVERS_B64 never carries it — yet a plain `update`
   * bumped the timestamp the drift check compares against the pod start, so
   * the first connect made every console say "restart required" for a
   * server the agent was already talking to (CLEAN-118).
   */
  abstract setOauthClientId(id: string, clientId: string): Promise<void>;
}
