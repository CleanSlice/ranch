import { ISecretListData } from './secret.types';

export abstract class ISecretGateway {
  abstract list(agentId: string): Promise<ISecretListData>;
  abstract set(agentId: string, key: string, value: string): Promise<void>;
  abstract delete(agentId: string, key: string): Promise<void>;
}
