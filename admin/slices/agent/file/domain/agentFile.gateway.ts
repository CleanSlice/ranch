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
 * Contract for an agent's file workspace. Implemented by `AgentFileGateway`,
 * which hides the Files SDK and the raw-fetch ZIP/raw-file endpoints.
 */
export abstract class IAgentFileGateway {
  abstract list(agentId: string): Promise<IFileNode[]>;
  /** Effective server limits (one call per session is enough). */
  abstract limits(agentId: string): Promise<IFileLimits>;
  abstract read(
    agentId: string,
    path: string,
    offset: number,
    limit: number,
  ): Promise<IFileChunk>;
  /** Throws `SaveRefusedError` on 409 (exists), 412 (changed) and 400 (invalid). */
  abstract save(
    agentId: string,
    path: string,
    content: string,
    options?: ISaveOptions,
  ): Promise<IFileContent>;
  abstract remove(
    agentId: string,
    path: string,
    recursive: boolean,
  ): Promise<number>;
  /** Bulk delete; 'conflict' when the selection would empty the workspace. */
  abstract removeMany(
    agentId: string,
    paths: string[],
    confirm?: boolean,
  ): Promise<IDeleteOutcome>;
  /**
   * Asks the runtime to push its working copy to S3. Without `confirm` the
   * server refuses (outcome 'conflict') when S3 holds edits newer than the
   * pod's last pull/push; `confirm: true` runs the sync regardless.
   */
  abstract sync(agentId: string, confirm?: boolean): Promise<ISyncOutcome>;
  /** Streams the agent's S3 prefix (or a selection) as a ZIP. */
  abstract exportZip(agentId: string, paths?: string[]): Promise<Blob>;
  /** Mints a short-lived link to the raw stored file (Open full). */
  abstract openLink(agentId: string, path: string): Promise<IOpenLink>;

  // ── Import (CLEAN-112) ────────────────────────────────────────
  /** Upload + validate once; returns the merge-mode plan with its importId. */
  abstract stageImport(
    agentId: string,
    archive: File,
    onProgress?: (percent: number) => void,
  ): Promise<IImportPlan>;
  abstract planImport(
    agentId: string,
    importId: string,
    mode: ImportMode,
    includeSessions: boolean,
  ): Promise<IImportPlan>;
  abstract applyImport(
    agentId: string,
    importId: string,
    options: IImportApplyOptions,
  ): Promise<IImportApplyOutcome>;

  // ── Change proposals (CLEAN-112) ──────────────────────────────
  abstract listProposals(
    agentId: string,
    chatAgentId: string,
    channel: string,
  ): Promise<IFileChangeProposal[]>;
  abstract getProposal(agentId: string, proposalId: string): Promise<IFileChangeProposal>;
  /** Raw proposed text (Edit before applying). */
  abstract proposalContent(agentId: string, proposalId: string): Promise<string>;
  /** Unified diff; throws with a clear message over the comparison cap (413). */
  abstract proposalDiff(agentId: string, proposalId: string, path?: string): Promise<string>;
  abstract applyProposal(
    agentId: string,
    proposalId: string,
    via: ProposalVia,
    options?: { content?: string; confirmRemove?: boolean },
  ): Promise<IProposalApplyOutcome>;
  abstract skipProposal(agentId: string, proposalId: string): Promise<IFileChangeProposal>;
}
