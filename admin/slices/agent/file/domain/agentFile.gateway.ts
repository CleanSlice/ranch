import type {
  IFileChunk,
  IFileContent,
  IFileNode,
  ISyncResult,
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
  abstract sync(agentId: string): Promise<ISyncResult>;
  /** Streams the agent's S3 prefix as a ZIP; the store triggers the download. */
  abstract exportZip(agentId: string): Promise<Blob>;
}
