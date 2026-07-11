export enum ApiKeyScopeTypes {
  /** Mint short-lived browser embed JWTs via POST /auth/embed/token. */
  EmbedMint = 'embed:mint',
  /**
   * Lets POST /auth/embed/token keep Owner/Admin roles in minted tokens
   * (normally stripped). A key with this scope is effectively admin access
   * to every agent's chat — treat it like the `admin` scope.
   */
  EmbedMintAdmin = 'embed:mint-admin',
  /** Full API surface (escape hatch). */
  Admin = 'admin',
}

export const ALL_API_KEY_SCOPES: ApiKeyScopeTypes[] = [
  ApiKeyScopeTypes.EmbedMint,
  ApiKeyScopeTypes.EmbedMintAdmin,
  ApiKeyScopeTypes.Admin,
];

export interface IApiKeyData {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiKeyScopeTypes[];
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdBy: string;
  createdAt: Date;
}

export interface ICreateApiKeyData {
  name: string;
  scopes: ApiKeyScopeTypes[];
  expiresAt?: Date | null;
  createdBy: string;
}

/** Returned exactly once on creation — `key` is the plaintext value the
 *  caller must store; we keep only its hash. */
export interface ICreatedApiKey {
  apiKey: IApiKeyData;
  key: string;
}
