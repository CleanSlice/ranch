import type {
  IFileChunk,
  IFileContent,
  IFileNode,
  ISyncOutcome,
} from './agentFile.types';

/**
 * Contract for an agent's file workspace. Implemented by `AgentFileGateway`,
 * which hides the Files SDK and the raw-fetch ZIP export.
 */
export abstract class IAgentFileGateway {
  abstract list(agentId: string): Promise<IFileNode[]>;
  abstract read(
    agentId: string,
    path: string,
    offset: number,
    limit: number,
  ): Promise<IFileChunk>;
  abstract save(
    agentId: string,
    path: string,
    content: string,
  ): Promise<IFileContent>;
  abstract remove(
    agentId: string,
    path: string,
    recursive: boolean,
  ): Promise<number>;
  /**
   * Asks the runtime to push its working copy to S3. Without `confirm` the
   * server refuses (outcome 'conflict') when S3 holds edits newer than the
   * pod's last pull/push; `confirm: true` runs the sync regardless.
   */
  abstract sync(agentId: string, confirm?: boolean): Promise<ISyncOutcome>;
  /** Streams the agent's S3 prefix as a ZIP; the store triggers the download. */
  abstract exportZip(agentId: string): Promise<Blob>;
}
