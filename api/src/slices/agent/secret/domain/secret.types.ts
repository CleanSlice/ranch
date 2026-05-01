export type SecretProviderTypes = 'aws' | 'file';

export interface ISecretEntry {
  name: string;
  value: string;
  updatedAt: Date | null;
}

export interface ISecretListData {
  provider: SecretProviderTypes;
  secrets: ISecretEntry[];
}
