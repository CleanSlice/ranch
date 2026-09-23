import type { IAgentFileGateway } from './agentFile.gateway';
import type {
  IDeleteOutcome,
  IFileChunk,
  IFileContent,
  IFileLimits,
  IFileNode,
  IOpenLink,
  ISaveOptions,
  ISyncOutcome,
} from './agentFile.types';

/**
 * Domain service for an agent's file workspace. The store layers the reactive
 * tree, tabs, drafts and the localStorage restart flags on top.
 */
export class AgentFileService {
  constructor(private gateway: IAgentFileGateway) {}

  list(agentId: string): Promise<IFileNode[]> {
    return this.gateway.list(agentId);
  }

  limits(agentId: string): Promise<IFileLimits> {
    return this.gateway.limits(agentId);
  }

  read(
    agentId: string,
    path: string,
    offset: number,
    limit: number,
  ): Promise<IFileChunk> {
    return this.gateway.read(agentId, path, offset, limit);
  }

  save(
    agentId: string,
    path: string,
    content: string,
    options?: ISaveOptions,
  ): Promise<IFileContent> {
    return this.gateway.save(agentId, path, content, options);
  }

  remove(agentId: string, path: string, recursive: boolean): Promise<number> {
    return this.gateway.remove(agentId, path, recursive);
  }

  removeMany(agentId: string, paths: string[], confirm?: boolean): Promise<IDeleteOutcome> {
    return this.gateway.removeMany(agentId, paths, confirm);
  }

  sync(agentId: string, confirm?: boolean): Promise<ISyncOutcome> {
    return this.gateway.sync(agentId, confirm);
  }

  exportZip(agentId: string, paths?: string[]): Promise<Blob> {
    return this.gateway.exportZip(agentId, paths);
  }

  openLink(agentId: string, path: string): Promise<IOpenLink> {
    return this.gateway.openLink(agentId, path);
  }
}
