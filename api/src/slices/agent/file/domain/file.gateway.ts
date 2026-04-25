import { IFileContent, IFileNode } from './file.types';

export abstract class IFileGateway {
  abstract list(agentId: string): Promise<IFileNode[]>;
  abstract read(agentId: string, path: string): Promise<IFileContent>;
  abstract save(agentId: string, path: string, content: string): Promise<void>;
}
