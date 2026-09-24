import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  forwardRef,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '#/setup/prisma/prisma.service';
import { IAgentGateway } from '#/agent/agent/domain/agent.gateway';
import { ISecretGateway } from '#/agent/secret/domain';
import { IBridleGateway } from '#/bridle/domain';
import { IInfraConfigGateway } from '#/setting/domain/infraConfig.gateway';
import { IMcpServerGateway } from '../../domain/mcpServer.gateway';
import { McpOauthClient } from '../data/mcpOauth.client';
import {
  IMcpOauthBundle,
  isEphemeralSubject,
  mcpOauthSecretKey,
  parseMcpOauthSecretKey,
} from './mcpOauth.types';

const base64url = (buf: Buffer): string => buf.toString('base64url');
/** Abandoned handshakes older than this are rejected/swept. */
const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Bundles of per-browser subjects (anon-*, share-*) unused for this long are
 * dropped (CLEAN-80). A real user's bundle is never swept: their account is
 * permanent and so is the token they connected.
 */
export const EPHEMERAL_BUNDLE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** How often the sweep runs; first pass shortly after boot. */
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const SWEEP_INITIAL_DELAY_MS = 5 * 60 * 1000;

export interface IMcpOauthStartInput {
  serverId: string;
  /** The agent whose secret store receives the bundle. */
  agentId: string;
  /**
   * Whose token it will be (CLEAN-80): the chat user's id, a share/anon
   * client id, or omitted for an agent-wide connection (what start_mcp_oauth
   * from the Rancher chat makes, and what pre-CLEAN-80 installs have).
   */
  subject?: string;
  /** Display only — "connected as …". */
  email?: string;
}

export interface IMcpOauthStatus {
  connected: boolean;
  /** Which bundle answered: the person's own, the agent-wide one, or none. */
  scope: 'subject' | 'agent' | null;
  email?: string;
  connectedAt?: number;
}

/**
 * Orchestrates the in-chat OAuth "Connect" flow (CLEAN-75). The interactive
 * half runs here in ranch (a public callback); the runtime later refreshes the
 * stored refresh token headlessly. One-time dynamic client registration yields
 * a shared client_id per server; tokens are stored as agent secrets, one per
 * subject (CLEAN-80) so several people on one shared channel each hold their
 * own account, plus the agent-wide bundle the operator can create.
 */
@Injectable()
export class McpOauthService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(McpOauthService.name);
  private sweeper: NodeJS.Timeout | null = null;
  private sweepStarter: NodeJS.Timeout | null = null;

  constructor(
    private readonly servers: IMcpServerGateway,
    private readonly client: McpOauthClient,
    private readonly prisma: PrismaService,
    private readonly secrets: ISecretGateway,
    private readonly bridle: IBridleGateway,
    @Inject(forwardRef(() => IAgentGateway))
    private readonly agents: IAgentGateway,
    private readonly infra: IInfraConfigGateway,
  ) {}

  onModuleInit(): void {
    // Late first pass so boot is not spent listing every agent's secrets;
    // unref so a cache sweep never holds the process open.
    this.sweepStarter = setTimeout(() => {
      this.sweepStarter = null;
      void this.sweepEphemeral();
      this.sweeper = setInterval(
        () => void this.sweepEphemeral(),
        SWEEP_INTERVAL_MS,
      );
      this.sweeper.unref?.();
    }, SWEEP_INITIAL_DELAY_MS);
    this.sweepStarter.unref?.();
  }

  onModuleDestroy(): void {
    if (this.sweepStarter) clearTimeout(this.sweepStarter);
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweepStarter = null;
    this.sweeper = null;
  }

  /**
   * Public base URL the user's browser reaches ranch-api on (for
   * redirect_uri). Read the way every other public address is — the
   * `infrastructure.api_public_url` setting, then `PUBLIC_API_URL` — instead
   * of the env var alone: a platform where the operator set the setting from
   * the console and never touched the pod env used to answer "not
   * configured" (seen on ranch.cleanslice.org). Only an explicit value is
   * accepted: the resolver's in-cluster and localhost fallbacks are fine for
   * an agent card, but a redirect_uri built from them sends the person's
   * browser nowhere, so the refusal names what to set.
   */
  private async publicApiUrl(): Promise<string> {
    const url = await this.infra.getConfiguredApiPublicUrl();
    if (!url) {
      throw new BadRequestException(
        'The public API URL is not configured — set infrastructure.api_public_url ' +
          '(Settings → Infrastructure) or PUBLIC_API_URL on the api pod; ' +
          'OAuth MCP connect is unavailable until then',
      );
    }
    return url;
  }

  private async callbackUri(serverId: string): Promise<string> {
    return `${await this.publicApiUrl()}/mcp-servers/${serverId}/oauth/callback`;
  }

  /**
   * Begin a connect: ensure the server is registered, mint PKCE state, and
   * return the authorization URL for the agent to hand the user.
   */
  async start(input: IMcpOauthStartInput): Promise<{ authorizeUrl: string }> {
    const { serverId, agentId } = input;
    const server = await this.servers.findById(serverId);
    if (!server) throw new NotFoundException('MCP server not found');
    if (server.authType !== 'oauth') {
      throw new BadRequestException('MCP server is not OAuth-based');
    }

    const meta = await this.client.discover(server.url);
    const redirectUri = await this.callbackUri(serverId);

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
      // Not `update`: that bumps updatedAt and the drift check then asks
      // for a restart the pod does not need (CLEAN-118).
      await this.servers.setOauthClientId(serverId, clientId);
      this.logger.log(`Registered OAuth client for server ${serverId}`);
    }

    const codeVerifier = base64url(randomBytes(32));
    const codeChallenge = base64url(
      createHash('sha256').update(codeVerifier).digest(),
    );
    const state = base64url(randomBytes(24));

    await this.prisma.mcpOauthState.create({
      data: {
        state,
        mcpServerId: serverId,
        agentId,
        codeVerifier,
        subject: input.subject ?? null,
        subjectEmail: input.email ?? null,
      },
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
   * code, store the bundle under the subject's key, and wake the running
   * agent over bridle. Returns the agent + server so the controller can
   * render a friendly page.
   */
  async handleCallback(
    serverId: string,
    state: string,
    code: string,
  ): Promise<{ agentId: string; serverName: string; subject: string }> {
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
      redirectUri: await this.callbackUri(serverId),
    });

    const subject = st.subject ?? undefined;
    const now = Date.now();
    const bundle: IMcpOauthBundle = {
      clientId: server.oauthClientId,
      issuer: meta.issuer,
      authorizationEndpoint: meta.authorization_endpoint,
      tokenEndpoint: meta.token_endpoint,
      revocationEndpoint: meta.revocation_endpoint ?? null,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      expiresAt: tokens.expires_in ? now + tokens.expires_in * 1000 : null,
      scope: tokens.scope ?? null,
      ...(subject ? { subject } : {}),
      ...(st.subjectEmail ? { email: st.subjectEmail } : {}),
      connectedAt: now,
      lastUsedAt: now,
    };

    await this.secrets.set(
      st.agentId,
      mcpOauthSecretKey(serverId, subject),
      JSON.stringify(bundle),
    );

    // Wake the running agent so it brings up the MCP now for exactly this
    // subject (same control channel as debug_set/sync). Best-effort — if the
    // agent is offline it will pick the token up from its secret store on
    // next boot. The agent-wide bundle reports the agent as its subject.
    const eventSubject = subject ?? st.agentId;
    this.bridle.notifyMcpConnected(st.agentId, {
      server: server.name,
      serverId,
      subject: eventSubject,
    });
    this.logger.log(
      `OAuth connected: agent=${st.agentId} server=${server.name} subject=${eventSubject}`,
    );

    return { agentId: st.agentId, serverName: server.name, subject: eventSubject };
  }

  /**
   * Whether a usable (refreshable) token exists — the subject's own first,
   * then the agent-wide bundle, the same order the runtime reads them in.
   */
  async status(
    serverId: string,
    agentId: string,
    subject?: string,
  ): Promise<IMcpOauthStatus> {
    const list = await this.secrets.list(agentId);
    const find = (name: string) =>
      list.secrets.find((s) => bareSecretName(s.name, agentId) === name);
    const candidates: Array<{ scope: 'subject' | 'agent'; name: string }> = [];
    if (subject) {
      candidates.push({
        scope: 'subject',
        name: mcpOauthSecretKey(serverId, subject),
      });
    }
    candidates.push({ scope: 'agent', name: mcpOauthSecretKey(serverId) });
    for (const { scope, name } of candidates) {
      const entry = find(name);
      if (!entry) continue;
      const bundle = parseBundle(entry.value);
      if (!bundle?.refreshToken) continue;
      return {
        connected: true,
        scope,
        ...(bundle.email ? { email: bundle.email } : {}),
        ...(bundle.connectedAt ? { connectedAt: bundle.connectedAt } : {}),
      };
    }
    return { connected: false, scope: null };
  }

  /**
   * Drop bundles of per-browser subjects nobody has used for
   * EPHEMERAL_BUNDLE_TTL_MS, revoking the refresh token first when the
   * provider told us where (RFC 7009). Best-effort throughout: one agent's
   * unreadable store must not stop the others, and a failed revoke still
   * deletes — a token we cannot revoke is not a reason to keep it.
   */
  async sweepEphemeral(now = Date.now()): Promise<number> {
    let dropped = 0;
    let agents: Array<{ id: string }>;
    try {
      agents = await this.agents.findAll();
    } catch (error) {
      this.logger.warn(
        `MCP OAuth sweep skipped: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    }
    for (const agent of agents) {
      let list: Awaited<ReturnType<ISecretGateway['list']>>;
      try {
        list = await this.secrets.list(agent.id);
      } catch {
        continue;
      }
      for (const entry of list.secrets) {
        const key = parseMcpOauthSecretKey(bareSecretName(entry.name, agent.id));
        if (!key?.subject || !isEphemeralSubject(key.subject)) continue;
        const bundle = parseBundle(entry.value);
        const lastUsed = bundle?.lastUsedAt ?? bundle?.connectedAt ?? 0;
        if (now - lastUsed < EPHEMERAL_BUNDLE_TTL_MS) continue;

        if (bundle?.revocationEndpoint && bundle.refreshToken) {
          await this.client
            .revoke(bundle.revocationEndpoint, bundle.refreshToken, bundle.clientId)
            .catch((error: unknown) =>
              this.logger.debug(
                `revoke failed for ${entry.name} on agent ${agent.id}: ${error instanceof Error ? error.message : String(error)}`,
              ),
            );
        }
        try {
          await this.secrets.delete(agent.id, entry.name);
          dropped++;
        } catch (error) {
          this.logger.warn(
            `could not drop ${entry.name} on agent ${agent.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
    if (dropped) {
      this.logger.log(`MCP OAuth sweep dropped ${dropped} stale bundle(s)`);
    }
    return dropped;
  }
}

/**
 * The name a listed secret was stored under. The S3-backed gateway reports
 * entries as `<scope>/<key>` (scope = the agent id for everything the OAuth
 * flow writes), the AWS gateway as the bare key; a comparison against the
 * bare key has to accept both, or `status` says "not connected" over a
 * bundle that is right there (found live on the file provider, CLEAN-80).
 */
function bareSecretName(listed: string, agentId: string): string {
  const scoped = `${agentId}/`;
  return listed.startsWith(scoped) ? listed.slice(scoped.length) : listed;
}

function parseBundle(raw: string): IMcpOauthBundle | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object'
      ? (parsed as IMcpOauthBundle)
      : null;
  } catch {
    return null;
  }
}
