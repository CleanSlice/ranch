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
}
