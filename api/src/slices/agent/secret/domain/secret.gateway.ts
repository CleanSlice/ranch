import { ISecretListData } from './secret.types';

export abstract class ISecretGateway {
  abstract list(agentId: string): Promise<ISecretListData>;
}
