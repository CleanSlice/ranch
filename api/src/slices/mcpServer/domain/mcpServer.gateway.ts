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
}
