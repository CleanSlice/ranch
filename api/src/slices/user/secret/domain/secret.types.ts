export type UserSecretProviderTypes = 'aws' | 'file';

export interface IUserSecretEntry {
  name: string;
  value: string;
  updatedAt: Date | null;
}

export interface IUserSecretListData {
  provider: UserSecretProviderTypes;
  secrets: IUserSecretEntry[];
}
