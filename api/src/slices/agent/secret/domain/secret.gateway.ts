import { ISecretListData } from './secret.types';

export abstract class ISecretGateway {
  abstract list(agentId: string): Promise<ISecretListData>;
  abstract set(agentId: string, key: string, value: string): Promise<void>;
  abstract delete(agentId: string, key: string): Promise<void>;
  // Atomic full-store replacement — what AWS's "Plaintext" save does.
  // Pass {} to clear the agent's secrets entirely.
  abstract replaceAll(
    agentId: string,
    store: Record<string, string>,
  ): Promise<void>;
}
