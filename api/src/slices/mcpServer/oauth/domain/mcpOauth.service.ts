import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '#/setup/prisma/prisma.service';
import { ISecretGateway } from '#/agent/secret/domain';
import { IBridleGateway } from '#/bridle/domain';
import { IMcpServerGateway } from '../../domain/mcpServer.gateway';
import { McpOauthClient } from '../data/mcpOauth.client';
import { IMcpOauthBundle, mcpOauthSecretKey } from './mcpOauth.types';

const base64url = (buf: Buffer): string => buf.toString('base64url');
/** Abandoned handshakes older than this are rejected/swept. */
const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Orchestrates the in-chat OAuth "Connect" flow (CLEAN-75). The interactive
 * half runs here in ranch (a public callback); the runtime later refreshes the
 * stored refresh token headlessly. One-time dynamic client registration yields
 * a shared client_id per server; each agent stores its own tokens as a secret.
 */
@Injectable()
export class McpOauthService {
  private readonly logger = new Logger(McpOauthService.name);

  constructor(
    private readonly servers: IMcpServerGateway,
    private readonly client: McpOauthClient,
    private readonly prisma: PrismaService,
    private readonly secrets: ISecretGateway,
    private readonly bridle: IBridleGateway,
  ) {}

  /** Public base URL the user's browser reaches ranch-api on (for redirect_uri). */
  private publicApiUrl(): string {
    const url = process.env.PUBLIC_API_URL;
    if (!url) {
      throw new BadRequestException(
        'PUBLIC_API_URL is not configured — OAuth MCP connect is unavailable',
      );
    }
    return url.replace(/\/+$/, '');
  }

  private callbackUri(serverId: string): string {
    return `${this.publicApiUrl()}/mcp-servers/${serverId}/oauth/callback`;
  }

  /**
   * Begin a connect: ensure the server is registered, mint PKCE state, and
   * return the authorization URL for the agent to hand the user.
   */
  async start(serverId: string, agentId: string): Promise<{ authorizeUrl: string }> {
    const server = await this.servers.findById(serverId);
    if (!server) throw new NotFoundException('MCP server not found');
    if (server.authType !== 'oauth') {
      throw new BadRequestException('MCP server is not OAuth-based');
    }

    const meta = await this.client.discover(server.url);
    const redirectUri = this.callbackUri(serverId);

    let clientId = server.oauthClientId;
    if (!clientId) {
      if (!meta.registration_endpoint) {
        throw new BadRequestException(
          'Authorization server does not support dynamic client registration',
        );
      }
      clientId = await this.client.register(
        meta.registration_endpoint,
        'Ranch',
        redirectUri,
      );
      await this.servers.update(serverId, { oauthClientId: clientId });
      this.logger.log(`Registered OAuth client for server ${serverId}`);
    }

    const codeVerifier = base64url(randomBytes(32));
    const codeChallenge = base64url(
      createHash('sha256').update(codeVerifier).digest(),
    );
    const state = base64url(randomBytes(24));

    await this.prisma.mcpOauthState.create({
      data: { state, mcpServerId: serverId, agentId, codeVerifier },
    });

    const url = new URL(meta.authorization_endpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('state', state);
    // RFC 8707 — bind the token to this MCP resource.
    url.searchParams.set('resource', server.url);
    if (meta.scopes_supported?.length) {
      url.searchParams.set('scope', meta.scopes_supported.join(' '));
    }

    return { authorizeUrl: url.toString() };
  }

  /**
   * Complete a connect from the OAuth callback: validate state, exchange the
   * code, store the per-agent bundle, and wake the running agent over bridle.
   * Returns the agent + server so the controller can render a friendly page.
   */
  async handleCallback(
    serverId: string,
    state: string,
    code: string,
  ): Promise<{ agentId: string; serverName: string }> {
    const st = await this.prisma.mcpOauthState.findUnique({ where: { state } });
    if (!st || st.mcpServerId !== serverId) {
      throw new BadRequestException('Unknown or mismatched OAuth state');
    }
    // Single-use: drop it whatever happens next.
    await this.prisma.mcpOauthState
      .delete({ where: { state } })
      .catch(() => undefined);
    if (Date.now() - st.createdAt.getTime() > STATE_TTL_MS) {
      throw new BadRequestException('OAuth handshake expired — start again');
    }

    const server = await this.servers.findById(serverId);
    if (!server || !server.oauthClientId) {
      throw new BadRequestException('MCP server is not registered for OAuth');
    }

    const meta = await this.client.discover(server.url);
    const tokens = await this.client.exchangeCode({
      tokenEndpoint: meta.token_endpoint,
      code,
      codeVerifier: st.codeVerifier,
      clientId: server.oauthClientId,
      redirectUri: this.callbackUri(serverId),
    });

    const bundle: IMcpOauthBundle = {
      clientId: server.oauthClientId,
      issuer: meta.issuer,
      authorizationEndpoint: meta.authorization_endpoint,
      tokenEndpoint: meta.token_endpoint,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      expiresAt: tokens.expires_in
        ? Date.now() + tokens.expires_in * 1000
        : null,
      scope: tokens.scope ?? null,
    };

    await this.secrets.set(
      st.agentId,
      mcpOauthSecretKey(serverId),
      JSON.stringify(bundle),
    );

    // Wake the running agent so it brings up the MCP now (same control channel
    // as debug_set/sync). Best-effort — if the agent is offline it will pick
    // the token up from its secret store on next boot.
    this.bridle.notifyMcpConnected(st.agentId, server.name);
    this.logger.log(
      `OAuth connected: agent=${st.agentId} server=${server.name}`,
    );

    return { agentId: st.agentId, serverName: server.name };
  }

  /** Whether the agent already holds a usable (refreshable) token. */
  async status(
    serverId: string,
    agentId: string,
  ): Promise<{ connected: boolean }> {
    const list = await this.secrets.list(agentId);
    const entry = list.secrets.find(
      (s) => s.name === mcpOauthSecretKey(serverId),
    );
    if (!entry) return { connected: false };
    try {
      const bundle = JSON.parse(entry.value) as IMcpOauthBundle;
      return { connected: Boolean(bundle.refreshToken) };
    } catch {
      return { connected: false };
    }
  }
}
