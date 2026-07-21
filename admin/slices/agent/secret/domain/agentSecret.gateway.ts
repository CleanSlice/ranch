import type { ISecretListData } from './agentSecret.types';

/**
 * Contract for an agent's secret store. Mutations return the full refreshed
 * list (so the UI updates in one round-trip) and throw the API's message on
 * failure (e.g. "AWS credentials are not configured").
 */
export abstract class IAgentSecretGateway {
  abstract list(agentId: string): Promise<ISecretListData | null>;
  abstract set(
    agentId: string,
    key: string,
    value: string,
  ): Promise<ISecretListData>;
  abstract remove(agentId: string, key: string): Promise<ISecretListData>;
  abstract replaceAll(
    agentId: string,
    store: Record<string, string>,
  ): Promise<ISecretListData>;
}
