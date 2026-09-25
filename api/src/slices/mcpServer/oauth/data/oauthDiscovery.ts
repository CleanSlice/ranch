import {
  assertPublicPeerAddress,
  assertResolvesPublic,
} from '#/agent/peer/domain/a2a.client';
import type { IAuthServerMetadata } from '../domain/mcpOauth.types';

/**
 * Finding the authorization server behind an MCP URL (CLEAN-122).
 *
 * Two documents can describe it, and they may disagree. The protected
 * resource metadata (RFC 9728, `/.well-known/oauth-protected-resource`,
 * pointed at by the `WWW-Authenticate: Bearer resource_metadata="…"` a bare
 * request gets) names the authorization server for THIS resource; the
 * MCP host's own `/.well-known/oauth-authorization-server` (RFC 8414) is
 * whatever the host chose to publish. Atlassian publishes both, and they
 * differ: the host document still points at its retired v1 server, the
 * resource document at `auth.atlassian.com`. The MCP SDK inside the agent
 * runtime follows the resource document, so a token minted through the
 * host document could not be refreshed there — "refresh_token is invalid".
 *
 * This walks the same order the SDK does, so both halves of ranch agree
 * on who issued the token: resource metadata first (header hint, then the
 * path-qualified and the root well-known), the host document only as the
 * fallback for servers that publish nothing else (Silpo).
 */
export interface IOauthDiscovery {
  metadata: IAuthServerMetadata;
  /**
   * RFC 8707 resource indicator sent with the authorize and token requests:
   * the `resource` the protected resource metadata names, else the MCP URL.
   */
  resource: string;
  /** Which document led here. */
  via: 'protected-resource' | 'origin';
}

interface IProtectedResourceMetadata {
  resource?: string;
  authorization_servers?: string[];
  scopes_supported?: string[];
}

const DISCOVERY_TIMEOUT_MS = 5_000;
const JSON_HEADERS = { Accept: 'application/json' };

type FetchFn = typeof fetch;

/**
 * Null when no OAuth metadata can be found — the probe reads that as "not
 * OAuth as far as we can tell"; the connect flow turns it into an error.
 */
export async function discoverOauthServer(
  serverUrl: string,
  fetchFn: FetchFn = fetch,
): Promise<IOauthDiscovery | null> {
  const server = new URL(serverUrl);

  const prm = await findProtectedResource(server, fetchFn);
  if (prm) {
    const metadata = await findAuthorizationServer(prm.server, server, fetchFn);
    if (metadata) {
      const scopes = prm.doc.scopes_supported?.filter(
        (s): s is string => typeof s === 'string',
      );
      return {
        metadata: {
          ...metadata,
          ...(scopes?.length ? { scopes_supported: scopes } : {}),
        },
        resource:
          typeof prm.doc.resource === 'string' && prm.doc.resource
            ? prm.doc.resource
            : serverUrl,
        via: 'protected-resource',
      };
    }
  }

  const metadata = await readAuthServerMetadata(
    new URL('/.well-known/oauth-authorization-server', server.origin),
    fetchFn,
  );
  return metadata ? { metadata, resource: serverUrl, via: 'origin' } : null;
}

/**
 * The resource document: from the challenge header when the server sends
 * one, else at the two well-known spots. Only a document that names at
 * least one authorization server counts.
 */
async function findProtectedResource(
  server: URL,
  fetchFn: FetchFn,
): Promise<{ doc: IProtectedResourceMetadata; server: URL } | null> {
  const candidates: URL[] = [];
  const hinted = await challengeHint(server, fetchFn);
  if (hinted) candidates.push(hinted);
  const path = server.pathname.replace(/\/+$/, '');
  if (path) {
    candidates.push(
      new URL(`/.well-known/oauth-protected-resource${path}`, server.origin),
    );
  }
  candidates.push(new URL('/.well-known/oauth-protected-resource', server.origin));

  for (const url of candidates) {
    if (!(await admitted(url, server))) continue;
    const doc = await readJson<IProtectedResourceMetadata>(url, fetchFn);
    const first = doc?.authorization_servers?.find(
      (s): s is string => typeof s === 'string' && s.length > 0,
    );
    if (!doc || !first) continue;
    try {
      const as = new URL(first);
      if (!(await admitted(as, server))) continue;
      return { doc, server: as };
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * `WWW-Authenticate: Bearer resource_metadata="…"` from a request without
 * credentials (RFC 9728 §5.1). A server that answers anything else, or
 * cannot be reached, simply gives no hint.
 */
async function challengeHint(server: URL, fetchFn: FetchFn): Promise<URL | null> {
  try {
    const res = await fetchFn(server.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: '{}',
      redirect: 'manual',
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
    if (res.status !== 401) return null;
    const challenge = res.headers?.get?.('www-authenticate') ?? '';
    const match = /resource_metadata="([^"]+)"/i.exec(challenge);
    if (!match) return null;
    return new URL(match[1]);
  } catch {
    return null;
  }
}

/**
 * Authorization server metadata in the SDK's order: for an issuer with a
 * path, the RFC 8414 form with the path after the well-known segment, then
 * the two OpenID forms; for a bare origin, RFC 8414 then OpenID.
 */
async function findAuthorizationServer(
  issuer: URL,
  server: URL,
  fetchFn: FetchFn,
): Promise<IAuthServerMetadata | null> {
  const path = issuer.pathname.replace(/\/+$/, '');
  const candidates = path
    ? [
        `/.well-known/oauth-authorization-server${path}`,
        `/.well-known/openid-configuration${path}`,
        `${path}/.well-known/openid-configuration`,
      ]
    : ['/.well-known/oauth-authorization-server', '/.well-known/openid-configuration'];
  for (const candidate of candidates) {
    const url = new URL(candidate, issuer.origin);
    if (!(await admitted(url, server))) continue;
    const metadata = await readAuthServerMetadata(url, fetchFn);
    if (metadata) return metadata;
  }
  return null;
}

async function readAuthServerMetadata(
  url: URL,
  fetchFn: FetchFn,
): Promise<IAuthServerMetadata | null> {
  const doc = await readJson<Partial<IAuthServerMetadata>>(url, fetchFn);
  if (
    !doc ||
    typeof doc.authorization_endpoint !== 'string' ||
    typeof doc.token_endpoint !== 'string'
  ) {
    return null;
  }
  return {
    ...doc,
    issuer: typeof doc.issuer === 'string' && doc.issuer ? doc.issuer : url.origin,
    authorization_endpoint: doc.authorization_endpoint,
    token_endpoint: doc.token_endpoint,
  };
}

async function readJson<T>(url: URL, fetchFn: FetchFn): Promise<T | null> {
  try {
    const res = await fetchFn(url.toString(), {
      headers: JSON_HEADERS,
      redirect: 'manual',
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const doc = (await res.json()) as unknown;
    return doc && typeof doc === 'object' ? (doc as T) : null;
  } catch {
    return null;
  }
}

/**
 * A URL another document handed us is only followed when it is public, or
 * on the MCP server's own origin (which the admin already vouched for).
 * Anything private is skipped, not reported — the next candidate may do.
 */
async function admitted(url: URL, server: URL): Promise<boolean> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.origin === server.origin) return true;
  try {
    assertPublicPeerAddress(url.toString());
    await assertResolvesPublic(url.toString());
    return true;
  } catch {
    return false;
  }
}
