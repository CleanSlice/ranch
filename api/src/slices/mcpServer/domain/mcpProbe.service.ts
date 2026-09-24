import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  assertPublicPeerAddress,
  assertResolvesPublic,
} from '#/agent/peer/domain/a2a.client';
import {
  IMcpProbeConnector,
  McpProbeHttpError,
  type IMcpProbeOauth,
  type IMcpProbeResult,
  type McpProbeHeaders,
} from './mcpProbe.types';
import type { McpServerAuthTypes } from './mcpServer.types';

/** How long the well-known lookup may take; the handshake has its own budget. */
const DISCOVERY_TIMEOUT_MS = 5_000;

/** Statuses that mean "you need a credential", on either transport. */
const AUTH_STATUSES = new Set([401, 403]);
/** Statuses on streamable HTTP that say "this endpoint is not a POST target"
 *  — the shape an SSE-only server answers with. */
const TRY_SSE_STATUSES = new Set([404, 405]);

export interface IMcpProbeInput {
  url: string;
  /** A stored credential to probe with; the result never echoes it. */
  authType?: McpServerAuthTypes;
  authValue?: string | null;
  /**
   * Skip the public-address guard. Only for rows an operator already
   * registered: the built-in servers live on cluster-internal hosts by
   * design, and a registered row is the operator's own choice. A URL typed
   * into the chat is never allowed there.
   */
  allowPrivate?: boolean;
}

/**
 * Looks at an MCP endpoint the way a client would and reports what it found
 * (CLEAN-78): which transport answers, whether it wants a credential and of
 * what kind, and — when it can be asked — the tools it exposes. The point is
 * that a person can paste https://mcp.silpo.ua/mcp into the chat and the
 * model learns "streamable HTTP, OAuth with dynamic registration, 40 tools"
 * without being told any of it.
 *
 * Order of operations: guard the address, read the OAuth metadata on the
 * origin (cheap, and it decides how a 401 is read), then handshake over
 * streamable HTTP, falling back to SSE when the endpoint answers like an
 * SSE-only server. Nothing here stores anything.
 */
@Injectable()
export class McpProbeService {
  private readonly logger = new Logger(McpProbeService.name);

  constructor(private readonly connector: IMcpProbeConnector) {}

  async probe(input: IMcpProbeInput): Promise<IMcpProbeResult> {
    const url = normalizeUrl(input.url);
    if (!input.allowPrivate) {
      // Same guard the A2A peer flow uses for operator-supplied addresses: a
      // probe reports tools/list output back into the chat, which is exactly
      // the read primitive an SSRF needs. Its refusal is re-thrown as a plain
      // 400 so a peer error code never leaks out of the MCP registry.
      try {
        assertPublicPeerAddress(url);
        await assertResolvesPublic(url);
      } catch (error) {
        throw new BadRequestException(
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    const headers = credentialHeaders(input.authType, input.authValue);
    const oauth = await this.discoverOauth(url);

    const base: IMcpProbeResult = {
      url,
      reachable: false,
      transport: null,
      authType: null,
      authRequired: false,
      oauth,
      server: null,
      tools: null,
    };

    // Streamable HTTP first: it is the current spec transport and what every
    // new server speaks. SSE only when the endpoint says it is not a POST
    // target — an auth refusal or a network failure is an answer already.
    const first = await this.attempt(url, 'streamableHttp', headers);
    if (first.ok) return this.reachable(base, 'streamableHttp', first, input);
    if (first.status !== undefined && TRY_SSE_STATUSES.has(first.status)) {
      const second = await this.attempt(url, 'sse', headers);
      if (second.ok) return this.reachable(base, 'sse', second, input);
      return this.unreachable(base, second, input);
    }
    return this.unreachable(base, first, input);
  }

  private reachable(
    base: IMcpProbeResult,
    transport: IMcpProbeResult['transport'],
    attempt: IAttempt & { ok: true },
    input: IMcpProbeInput,
  ): IMcpProbeResult {
    return {
      ...base,
      reachable: true,
      transport,
      // The handshake went through with what we sent: either nothing (open
      // server) or the stored credential (then its type is confirmed).
      authType: input.authType && input.authType !== 'none' ? input.authType : 'none',
      server: attempt.handshake.server,
      tools: attempt.handshake.tools,
    };
  }

  private unreachable(
    base: IMcpProbeResult,
    attempt: IAttempt & { ok: false },
    input: IMcpProbeInput,
  ): IMcpProbeResult {
    const authRequired =
      attempt.status !== undefined && AUTH_STATUSES.has(attempt.status);
    if (!authRequired) {
      return { ...base, error: attempt.error };
    }
    // A refusal is informative: the transport answered, so we know which
    // one it is, and the metadata says which kind of credential it wants.
    const authType: McpServerAuthTypes = base.oauth ? 'oauth' : 'bearer';
    const sentCredential = input.authType && input.authType !== 'none';
    return {
      ...base,
      transport: attempt.transport,
      authRequired: true,
      authType,
      error: sentCredential
        ? `The stored ${input.authType} credential was refused (${attempt.status})`
        : base.oauth
          ? 'The server requires OAuth; register it with authType oauth and connect an agent with start_mcp_oauth'
          : `The server requires a credential (${attempt.status}) and publishes no OAuth metadata — a bearer token or header value has to be supplied`,
    };
  }

  private async attempt(
    url: string,
    transport: 'streamableHttp' | 'sse',
    headers: McpProbeHeaders,
  ): Promise<IAttempt> {
    try {
      const handshake = await this.connector.handshake(url, transport, headers);
      return { ok: true, transport, handshake };
    } catch (error) {
      if (error instanceof McpProbeHttpError) {
        return {
          ok: false,
          transport,
          status: error.status,
          error: error.message,
        };
      }
      const message = error instanceof Error ? error.message : String(error);
      this.logger.debug(`probe ${transport} ${url}: ${message}`);
      return { ok: false, transport, error: message };
    }
  }

  /**
   * RFC 8414 metadata on the endpoint's origin — the same place
   * `McpOauthClient.discover` reads for a real connect. Soft: a missing or
   * malformed document means "not OAuth as far as we can tell", never an
   * error, because most servers do not publish one.
   */
  private async discoverOauth(url: string): Promise<IMcpProbeOauth | null> {
    const origin = new URL(url).origin;
    const wellKnown = `${origin}/.well-known/oauth-authorization-server`;
    try {
      const res = await fetch(wellKnown, {
        headers: { Accept: 'application/json' },
        redirect: 'manual',
        signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const meta = (await res.json()) as Record<string, unknown>;
      if (
        typeof meta.authorization_endpoint !== 'string' ||
        typeof meta.token_endpoint !== 'string'
      ) {
        return null;
      }
      const methods = Array.isArray(meta.code_challenge_methods_supported)
        ? (meta.code_challenge_methods_supported as unknown[])
        : null;
      const scopes = Array.isArray(meta.scopes_supported)
        ? (meta.scopes_supported as unknown[]).filter(
            (s): s is string => typeof s === 'string',
          )
        : [];
      return {
        issuer: typeof meta.issuer === 'string' ? meta.issuer : origin,
        dynamicRegistration: typeof meta.registration_endpoint === 'string',
        pkce: methods === null || methods.includes('S256'),
        scopes,
      };
    } catch (error) {
      this.logger.debug(
        `no OAuth metadata at ${wellKnown}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }
}

type IAttempt =
  | {
      ok: true;
      transport: 'streamableHttp' | 'sse';
      handshake: Awaited<ReturnType<IMcpProbeConnector['handshake']>>;
    }
  | {
      ok: false;
      transport: 'streamableHttp' | 'sse';
      status?: number;
      error: string;
    };

function normalizeUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new BadRequestException(`Not a URL: ${raw}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BadRequestException(
      `An MCP endpoint is an http(s) URL, not ${parsed.protocol}`,
    );
  }
  return parsed.toString();
}

/**
 * The headers a stored credential turns into. Bearer goes into
 * `Authorization`. A `header` value is accepted in both spellings that exist
 * today: the runtime's `Header-Name: value` (mcp.gateway.ts) and the admin
 * form's JSON `{ "X-Foo": "value" }` — the two have drifted, and a probe that
 * read only one would call a working server unreachable.
 */
export function credentialHeaders(
  authType: McpServerAuthTypes | undefined,
  authValue: string | null | undefined,
): McpProbeHeaders {
  if (!authType || authType === 'none' || authType === 'oauth' || !authValue) {
    return {};
  }
  if (authType === 'bearer') return { Authorization: `Bearer ${authValue}` };
  const trimmed = authValue.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const out: McpProbeHeaders = {};
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof v === 'string') out[k] = v;
        }
        return out;
      }
    } catch {
      // Fall through to the colon form.
    }
  }
  const colon = trimmed.indexOf(':');
  if (colon === -1) return {};
  return { [trimmed.slice(0, colon).trim()]: trimmed.slice(colon + 1).trim() };
}
