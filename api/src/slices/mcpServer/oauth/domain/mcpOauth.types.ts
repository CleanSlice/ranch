// OAuth 2.1 metadata + token shapes for the in-chat MCP "Connect" flow.
// See CLEAN-75. The runtime never runs the interactive half — ranch does the
// one-time authorize/callback and stores the bundle below as a per-agent
// secret; the runtime seeds an OAuthClientProvider from it and refreshes.

/** Subset of RFC 8414 authorization-server metadata that we consume. */
export interface IAuthServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  code_challenge_methods_supported?: string[];
  scopes_supported?: string[];
}

/** Raw token-endpoint response (snake_case as the server returns it). */
export interface IOauthTokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
}

/**
 * What we persist per agent under the secret key `mcpOauth:<serverId>`. The
 * runtime reads exactly this to build its OAuthClientProvider and refresh
 * without any browser. camelCase — it is our own contract, not the wire.
 */
export interface IMcpOauthBundle {
  clientId: string;
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  accessToken: string;
  refreshToken: string | null;
  /** epoch ms, or null when the server didn't send expires_in. */
  expiresAt: number | null;
  scope: string | null;
}

/** Secret key under which an agent's bundle for a given server is stored. */
export const mcpOauthSecretKey = (serverId: string): string =>
  `mcpOauth:${serverId}`;
