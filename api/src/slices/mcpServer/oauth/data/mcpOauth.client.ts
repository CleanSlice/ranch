import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { IOauthTokenResponse } from '../domain/mcpOauth.types';
import { discoverOauthServer, IOauthDiscovery } from './oauthDiscovery';

/** A discovery answer is reused this long: start and callback share one. */
const DISCOVERY_CACHE_MS = 10 * 60 * 1000;

/**
 * Thin HTTP client for the remote OAuth 2.1 authorization server backing an MCP
 * server. Isolates every outbound call (discovery, dynamic client
 * registration, code exchange) so the service stays pure orchestration. Uses
 * global fetch (Node 22). See CLEAN-75.
 */
@Injectable()
export class McpOauthClient {
  private readonly logger = new Logger(McpOauthClient.name);

  private readonly discovered = new Map<
    string,
    { at: number; answer: IOauthDiscovery }
  >();

  /**
   * The authorization server for this MCP URL, found the way the agent
   * runtime's MCP SDK finds it (RFC 9728 resource metadata first, the host
   * document as the fallback — see `oauthDiscovery.ts`, CLEAN-122), so the
   * token we mint is one the runtime can refresh. Cached briefly: the
   * callback reads the same answer the start did.
   */
  async discover(serverUrl: string): Promise<IOauthDiscovery> {
    const hit = this.discovered.get(serverUrl);
    if (hit && Date.now() - hit.at < DISCOVERY_CACHE_MS) return hit.answer;
    const answer = await discoverOauthServer(serverUrl);
    if (!answer) {
      throw new BadGatewayException(
        `OAuth discovery failed: no authorization server metadata for ${serverUrl}`,
      );
    }
    this.logger.log(
      `OAuth discovery for ${serverUrl}: ${answer.metadata.issuer} via ${answer.via}`,
    );
    this.discovered.set(serverUrl, { at: Date.now(), answer });
    return answer;
  }

  /**
   * RFC 7591 dynamic client registration as a PUBLIC client (PKCE, no secret).
   * Done once per MCP server; the returned client_id is shared across agents.
   */
  async register(
    registrationEndpoint: string,
    clientName: string,
    redirectUri: string,
  ): Promise<string> {
    const res = await fetch(registrationEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_name: clientName,
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        application_type: 'web',
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new BadGatewayException(
        `Dynamic client registration failed (${res.status}): ${body.slice(0, 300)}`,
      );
    }
    const json = (await res.json()) as { client_id?: string };
    if (!json.client_id) {
      throw new BadGatewayException('Registration response missing client_id');
    }
    return json.client_id;
  }

  /**
   * Exchange an authorization code (+ PKCE verifier) for tokens. `resource`
   * (RFC 8707) goes on the token request too, as it did on the authorize
   * request — a server that binds tokens to a resource expects both.
   */
  async exchangeCode(input: {
    tokenEndpoint: string;
    code: string;
    codeVerifier: string;
    clientId: string;
    redirectUri: string;
    resource: string;
  }): Promise<IOauthTokenResponse> {
    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      code_verifier: input.codeVerifier,
      client_id: input.clientId,
      redirect_uri: input.redirectUri,
      resource: input.resource,
    });
    const res = await fetch(input.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: form.toString(),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new BadGatewayException(
        `Token exchange failed (${res.status}): ${body.slice(0, 300)}`,
      );
    }
    return (await res.json()) as IOauthTokenResponse;
  }

  /**
   * RFC 7009 revocation of a refresh token we are about to forget (the
   * CLEAN-80 sweep). Public client, so only `client_id` identifies us. A
   * provider answers 200 whether or not it knew the token; anything else is
   * reported and the caller deletes the bundle regardless.
   */
  async revoke(
    revocationEndpoint: string,
    refreshToken: string,
    clientId: string,
  ): Promise<void> {
    const form = new URLSearchParams({
      token: refreshToken,
      token_type_hint: 'refresh_token',
      client_id: clientId,
    });
    const res = await fetch(revocationEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    if (!res.ok) {
      throw new BadGatewayException(`Token revocation failed (${res.status})`);
    }
  }
}
