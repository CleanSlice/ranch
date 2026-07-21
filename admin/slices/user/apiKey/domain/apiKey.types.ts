// Domain types for API keys.

/** Mirror of the API enum, with code-friendly key names. Values match what the
 *  generated SDK / hub expect on the wire. */
export enum ApiKeyScopeTypes {
  EmbedMint = 'embed:mint',
  EmbedMintAdmin = 'embed:mint-admin',
  Admin = 'admin',
}

export interface IApiKeyData {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiKeyScopeTypes[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdBy: string;
  createdAt: string;
}

export interface ICreateApiKeyInput {
  name: string;
  scopes: ApiKeyScopeTypes[];
  expiresAt?: string;
}

export interface ICreatedApiKey {
  apiKey: IApiKeyData;
  /** Plaintext key — returned exactly once at creation. */
  key: string;
}
