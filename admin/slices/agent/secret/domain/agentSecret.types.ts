// Domain types for an agent's secret store.

export type SecretProviderTypes = 'aws' | 'file';

export interface ISecretEntry {
  name: string;
  value: string;
  updatedAt: string | null;
}

export interface ISecretListData {
  provider: SecretProviderTypes;
  secrets: ISecretEntry[];
}
