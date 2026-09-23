import type { IAgentFileGateway } from './agentFile.gateway';
import type {
  IDeleteOutcome,
  IFileChunk,
  IFileContent,
  IFileLimits,
  IFileChangeProposal,
  IFileNode,
  IImportApplyOptions,
  IImportApplyOutcome,
  IImportPlan,
  IOpenLink,
  IProposalApplyOutcome,
  ISaveOptions,
  ISyncOutcome,
  ImportMode,
  ProposalVia,
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

  stageImport(
    agentId: string,
    archive: File,
    onProgress?: (percent: number) => void,
  ): Promise<IImportPlan> {
    return this.gateway.stageImport(agentId, archive, onProgress);
  }

  planImport(
    agentId: string,
    importId: string,
    mode: ImportMode,
    includeSessions: boolean,
  ): Promise<IImportPlan> {
    return this.gateway.planImport(agentId, importId, mode, includeSessions);
  }

  applyImport(
    agentId: string,
    importId: string,
    options: IImportApplyOptions,
  ): Promise<IImportApplyOutcome> {
    return this.gateway.applyImport(agentId, importId, options);
  }

  listProposals(agentId: string, chatAgentId: string, channel: string): Promise<IFileChangeProposal[]> {
    return this.gateway.listProposals(agentId, chatAgentId, channel);
  }

  getProposal(agentId: string, proposalId: string): Promise<IFileChangeProposal> {
    return this.gateway.getProposal(agentId, proposalId);
  }

  proposalContent(agentId: string, proposalId: string): Promise<string> {
    return this.gateway.proposalContent(agentId, proposalId);
  }

  proposalDiff(agentId: string, proposalId: string, path?: string): Promise<string> {
    return this.gateway.proposalDiff(agentId, proposalId, path);
  }

  applyProposal(
    agentId: string,
    proposalId: string,
    via: ProposalVia,
    options?: { content?: string; confirmRemove?: boolean },
  ): Promise<IProposalApplyOutcome> {
    return this.gateway.applyProposal(agentId, proposalId, via, options);
  }

  skipProposal(agentId: string, proposalId: string): Promise<IFileChangeProposal> {
    return this.gateway.skipProposal(agentId, proposalId);
  }
}
