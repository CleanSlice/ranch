import type { IAgentFileGateway } from './agentFile.gateway';
import type {
  IFileChunk,
  IFileContent,
  IFileNode,
  ISyncResult,
} from './agentFile.types';

/**
 * Domain service for an agent's file workspace. The store layers the reactive
 * tree + the localStorage restart flags on top.
 */
export class AgentFileService {
  constructor(private gateway: IAgentFileGateway) {}

  list(agentId: string): Promise<IFileNode[]> {
    return this.gateway.list(agentId);
  }

  read(
    agentId: string,
    path: string,
    offset: number,
    limit: number,
  ): Promise<IFileChunk> {
    return this.gateway.read(agentId, path, offset, limit);
  }

  save(agentId: string, path: string, content: string): Promise<IFileContent> {
    return this.gateway.save(agentId, path, content);
  }

  remove(agentId: string, path: string, recursive: boolean): Promise<number> {
    return this.gateway.remove(agentId, path, recursive);
  }

  sync(agentId: string): Promise<ISyncResult> {
    return this.gateway.sync(agentId);
  }

  exportZip(agentId: string): Promise<Blob> {
    return this.gateway.exportZip(agentId);
  }
}
