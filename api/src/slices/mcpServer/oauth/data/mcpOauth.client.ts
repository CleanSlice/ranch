import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import {
  IAuthServerMetadata,
  IOauthTokenResponse,
} from '../domain/mcpOauth.types';

/**
 * Thin HTTP client for the remote OAuth 2.1 authorization server backing an MCP
 * server. Isolates every outbound call (discovery, dynamic client
 * registration, code exchange) so the service stays pure orchestration. Uses
 * global fetch (Node 22). See CLEAN-75.
 */
@Injectable()
export class McpOauthClient {
  private readonly logger = new Logger(McpOauthClient.name);

  /**
   * RFC 8414 discovery. The MCP server URL's origin hosts the authorization
   * server metadata (verified for Silpo at
   * https://mcp.silpo.ua/.well-known/oauth-authorization-server).
   */
  async discover(serverUrl: string): Promise<IAuthServerMetadata> {
    const origin = new URL(serverUrl).origin;
    const url = `${origin}/.well-known/oauth-authorization-server`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      throw new BadGatewayException(
        `OAuth discovery failed (${res.status}) at ${url}`,
      );
    }
    const meta = (await res.json()) as IAuthServerMetadata;
    if (!meta.authorization_endpoint || !meta.token_endpoint) {
      throw new BadGatewayException(
        `OAuth metadata at ${url} missing authorization/token endpoint`,
      );
    }
    return meta;
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

  /** Exchange an authorization code (+ PKCE verifier) for tokens. */
  async exchangeCode(input: {
    tokenEndpoint: string;
    code: string;
    codeVerifier: string;
    clientId: string;
    redirectUri: string;
  }): Promise<IOauthTokenResponse> {
    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      code_verifier: input.codeVerifier,
      client_id: input.clientId,
      redirect_uri: input.redirectUri,
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
}
