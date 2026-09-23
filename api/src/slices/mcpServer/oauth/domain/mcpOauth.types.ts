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
  /** RFC 7009 — where a swept refresh token is handed back (CLEAN-80). */
  revocation_endpoint?: string;
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
 * What we persist under the secret key from `mcpOauthSecretKey`. The
 * runtime reads exactly this to build its OAuthClientProvider and refresh
 * without any browser. camelCase — it is our own contract, not the wire.
 */
export interface IMcpOauthBundle {
  clientId: string;
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  /** Absent on bundles stored before CLEAN-80; sweeping then cannot revoke. */
  revocationEndpoint?: string | null;
  accessToken: string;
  refreshToken: string | null;
  /** epoch ms, or null when the server didn't send expires_in. */
  expiresAt: number | null;
  scope: string | null;
  /**
   * Whose token this is (CLEAN-80): the chat user's id, a share/anon client
   * id, or the agent id for a connection made on the agent's behalf. Absent
   * on the agent-wide bundles stored before subjects existed.
   */
  subject?: string;
  /** For "connected as …" in the chat; never used as a key. */
  email?: string;
  /** epoch ms — when the login completed. */
  connectedAt?: number;
  /**
   * epoch ms — bumped by the runtime when the token is used, at most once
   * an hour. What the sweep reads to drop bundles nobody comes back for.
   */
  lastUsedAt?: number;
}

/** Prefix every bundle's secret name starts with. */
export const MCP_OAUTH_SECRET_PREFIX = 'mcpOauth:';

/**
 * Secret key for a server's bundle. With a subject the token belongs to one
 * person on that agent (`mcpOauth:<serverId>:<subject>`); without one it is
 * the agent-wide bundle the pre-CLEAN-80 flow stored and that the Rancher
 * chat's start_mcp_oauth still creates (`mcpOauth:<serverId>`). The runtime
 * looks up the personal key first and falls back to the agent-wide one.
 */
export const mcpOauthSecretKey = (serverId: string, subject?: string): string =>
  subject
    ? `${MCP_OAUTH_SECRET_PREFIX}${serverId}:${subject}`
    : `${MCP_OAUTH_SECRET_PREFIX}${serverId}`;

/**
 * Reads a secret name back into its parts, or null when it is not one of
 * ours. A subject may itself contain `:` (no id format we mint does, but the
 * split is on the first separator after the server id so nothing breaks if
 * one ever did).
 */
export function parseMcpOauthSecretKey(
  name: string,
): { serverId: string; subject: string | null } | null {
  if (!name.startsWith(MCP_OAUTH_SECRET_PREFIX)) return null;
  const rest = name.slice(MCP_OAUTH_SECRET_PREFIX.length);
  if (!rest) return null;
  const sep = rest.indexOf(':');
  if (sep === -1) return { serverId: rest, subject: null };
  const serverId = rest.slice(0, sep);
  const subject = rest.slice(sep + 1);
  if (!serverId || !subject) return null;
  return { serverId, subject };
}

/**
 * Subjects that are per browser rather than per person: a new browser, an
 * incognito window or cleared site data mints a new one, so their bundles
 * pile up unless swept. A real user's `sub` is never one of these.
 */
export function isEphemeralSubject(subject: string): boolean {
  return subject.startsWith('anon-') || subject.startsWith('share-');
}
