import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { Tool, ToolTopics } from '#mcp';
import type { IConditionallyListedTool } from '#/mcp/interfaces/conditional-listing.interface';
import {
  callerIsOperator,
  CONFIRM_SENTENCE,
  confirmed,
  ok,
  requireOperator,
  type ToolResult,
} from '#/mcp/tooling';
import { IAgentGateway } from '#/agent/agent/domain';
import { IAuthTokenPayload } from '#/user/auth/domain';
import { ShareLinkService, type IShareLinkState } from './domain';

type AuthedRequest = Request & { user?: IAuthTokenPayload };

/** The app page a share link opens (`app/pages/share.vue`). */
const SHARE_PATH = '/share';

/** Port `app` listens on under `ranch dev` (`app/package.json`). */
const DEV_APP_PORT = 3000;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Admin is served from `admin.<domain>`, the app from `<domain>` itself
 *  (`terraform/modules/apps/main.tf`: `admin_host` / `app_host`). */
const ADMIN_HOST_PREFIX = 'admin.';

/**
 * Where the app console lives, as an origin with no trailing slash, or null
 * when the API has no way to know.
 *
 * The API never builds share URLs for the console: the app reads its own
 * address bar and admin derives the app's address from its own
 * (`admin/slices/share/utils/shareUrl.ts`). A chat has no address bar, so
 * the tool applies admin's rule from the API's side: `PUBLIC_APP_URL` when
 * set (the API-side twin of admin's `NUXT_PUBLIC_APP_URL`), else derived from
 * `ADMIN_URL` exactly as admin derives it — `admin.<domain>` → `<domain>`,
 * localhost → the app's dev port. Anything else is null: a wrong guess is a
 * link that looks fine and opens nothing, so the tool hands back the path
 * and says so instead.
 */
export function resolveAppOrigin(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const explicit = toHttpBase(env.PUBLIC_APP_URL);
  if (explicit) return explicit;

  const admin = toUrl(env.ADMIN_URL ?? env.ADMIN_BASE_URL);
  if (!admin) return null;
  if (LOCAL_HOSTS.has(admin.hostname)) {
    return `${admin.protocol}//${admin.hostname}:${DEV_APP_PORT}`;
  }
  if (admin.hostname.startsWith(ADMIN_HOST_PREFIX)) {
    const appHost = admin.host.slice(ADMIN_HOST_PREFIX.length);
    // `admin.com` is somebody's whole domain, not an admin subdomain of `com`.
    if (appHost.includes('.')) return `${admin.protocol}//${appHost}`;
  }
  return null;
}

function toUrl(value: string | null | undefined): URL | null {
  if (!value) return null;
  try {
    return new URL(value.trim());
  } catch {
    return null;
  }
}

/** Accepts only http(s); keeps a sub-path if the app is served under one. */
function toHttpBase(value: string | null | undefined): string | null {
  const url = toUrl(value);
  if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
    return null;
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}

/**
 * The public share link of an agent, from the chat (CLEAN-109). Mirrors
 * `ShareLinkController` call for call: the same `ShareLinkService`, the same
 * actor (the caller's token subject, recorded as who created or revoked the
 * link), the same 404 for an unknown agent.
 *
 * Operator-only. The controller lets any console user share an agent but
 * keeps the `Agent` role out: a runtime must not mint or revoke public links
 * to itself or to a colleague. An admin agent holds Owner and acts as the
 * operator; for a plain agent these tools are not listed and not callable.
 *
 * The share URL is the product — the person asked for a link to hand out —
 * so an active link comes back as the full URL. Nothing else about the token
 * is returned: no bare `token` field, and a revoked link shows no token at
 * all, because the service already withholds a dead one.
 */
@Injectable()
export class ShareLinkTool implements IConditionallyListedTool {
  private readonly logger = new Logger(ShareLinkTool.name);

  constructor(
    private readonly shareLinks: ShareLinkService,
    private readonly agents: IAgentGateway,
  ) {}

  async isListedForRequest(httpRequest: Request): Promise<boolean> {
    return Promise.resolve(callerIsOperator(httpRequest));
  }

  @Tool({
    name: 'get_share_link',
    topic: ToolTopics.AgentWorkspace,
    title: 'Show the share link',
    template: 'Does the agent «name» have a public share link?',
    description:
      'Whether an agent is publicly shared, and if so the link visitors ' +
      'open to chat with it, plus when it was created and last regenerated. ' +
      'Not shared or revoked: active false and no link. Takes the agent id ' +
      '— resolve a name with list_agents first.',
    parameters: z.object({
      agentId: z
        .string()
        .describe('Agent id, e.g. agent-abc123 (list_agents has them)'),
    }),
  })
  async getShareLink(
    { agentId }: { agentId: string },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const agent = await this.agents.findById(agentId);
    if (!agent) return notFound(agentId);
    return this.guard(agentId, async () =>
      present(agent, await this.shareLinks.getState(agentId)),
    );
  }

  @Tool({
    name: 'create_share_link',
    topic: ToolTopics.AgentWorkspace,
    title: 'Create a share link',
    template: 'Create a public share link for the agent «name»',
    description:
      'Share the agent publicly: anyone who opens the returned link can ' +
      'chat with it, no account needed. Idempotent — an agent that is ' +
      'already shared gets its existing link back unchanged, so this never ' +
      'invalidates a link already in circulation (use regenerate_share_link ' +
      'for that). Takes the agent id — resolve a name with list_agents first.',
    parameters: z.object({
      agentId: z
        .string()
        .describe('Agent id, e.g. agent-abc123 (list_agents has them)'),
    }),
  })
  async createShareLink(
    { agentId }: { agentId: string },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const userId = requireSub(httpRequest);
    const agent = await this.agents.findById(agentId);
    if (!agent) return notFound(agentId);
    return this.guard(agentId, async () => {
      const state = await this.shareLinks.share(agentId, userId);
      this.logger.log(`Share link ensured through MCP: agent=${agentId}`);
      return present(agent, state);
    });
  }

  @Tool({
    name: 'regenerate_share_link',
    topic: ToolTopics.AgentWorkspace,
    title: 'Regenerate the share link',
    template: 'Regenerate the share link of the agent «name»',
    destructive: true,
    description:
      'Replace the share link with a new one. The old link stops working ' +
      'in the same write, so everyone holding it loses access immediately; ' +
      'a revoked link is revived with the new address. Returns the new link. ' +
      'Takes the agent id — resolve a name with list_agents first. ' +
      CONFIRM_SENTENCE,
    parameters: z.object({
      agentId: z
        .string()
        .describe('Agent id, e.g. agent-abc123 (list_agents has them)'),
      confirm: z
        .boolean()
        .describe('Set true only after the person confirmed in the chat.'),
    }),
  })
  async regenerateShareLink(
    args: { agentId: string; confirm?: boolean },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const userId = requireSub(httpRequest);
    const { agentId } = args;
    const agent = await this.agents.findById(agentId);
    if (!agent) return notFound(agentId);
    const refusal = confirmed(
      args,
      `regenerate the share link of agent «${agent.name}» — the current ` +
        'link stops working immediately for everyone who has it',
    );
    if (refusal) return refusal;
    return this.guard(agentId, async () => {
      const state = await this.shareLinks.regenerate(agentId, userId);
      this.logger.log(`Share link regenerated through MCP: agent=${agentId}`);
      return present(agent, state, 'The previous link no longer works.');
    });
  }

  @Tool({
    name: 'revoke_share_link',
    topic: ToolTopics.AgentWorkspace,
    title: 'Revoke the share link',
    template: 'Revoke the share link of the agent «name»',
    destructive: true,
    description:
      'Stop sharing the agent. Visitors are cut off on their very next ' +
      'request; the old link is dead for good — create_share_link later ' +
      'mints a different one. Revoking an agent that is not shared changes ' +
      'nothing and is not an error. Takes the agent id — resolve a name with ' +
      'list_agents first. ' +
      CONFIRM_SENTENCE,
    parameters: z.object({
      agentId: z
        .string()
        .describe('Agent id, e.g. agent-abc123 (list_agents has them)'),
      confirm: z
        .boolean()
        .describe('Set true only after the person confirmed in the chat.'),
    }),
  })
  async revokeShareLink(
    args: { agentId: string; confirm?: boolean },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const userId = requireSub(httpRequest);
    const { agentId } = args;
    const agent = await this.agents.findById(agentId);
    if (!agent) return notFound(agentId);
    const refusal = confirmed(
      args,
      `revoke the share link of agent «${agent.name}» — visitors are cut ` +
        'off on their next request',
    );
    if (refusal) return refusal;
    return this.guard(agentId, async () => {
      const state = await this.shareLinks.revoke(agentId, userId);
      this.logger.log(`Share link revoked through MCP: agent=${agentId}`);
      return present(
        agent,
        state,
        state.revokedAt
          ? 'The link is dead; create_share_link mints a new one when wanted.'
          : 'Nothing to revoke — this agent was not shared.',
      );
    });
  }

  /**
   * The agent was resolved a moment ago, but the service checks again and
   * 404s if it vanished in between. That is a not-found for the model, not a
   * crash.
   */
  private async guard(
    agentId: string,
    run: () => Promise<ToolResult>,
  ): Promise<ToolResult> {
    try {
      return await run();
    } catch (err) {
      if (err instanceof NotFoundException) return notFound(agentId);
      throw err;
    }
  }
}

/** Same belt-and-braces read as `ShareLinkController.requireSub`: the actor
 *  recorded on the row must never be `undefined`. */
function requireSub(httpRequest: AuthedRequest): string {
  const sub = httpRequest.user?.sub;
  if (!sub) throw new ForbiddenException('No authenticated user');
  return sub;
}

function notFound(agentId: string): ToolResult {
  return ok({
    error: `Agent ${agentId} not found — call list_agents to find the id`,
  });
}

/**
 * The owner-facing state as the console shows it: a link when active, the
 * dates always, the raw token never as its own field. Without a known app
 * origin the path is handed back with a note, so the person still gets
 * something they can complete by hand.
 */
function present(
  agent: { id: string; name: string },
  state: IShareLinkState,
  note?: string,
): ToolResult {
  const base = {
    agentId: agent.id,
    agentName: agent.name,
    active: state.active,
    createdAt: state.createdAt,
    revokedAt: state.revokedAt,
    rotatedAt: state.rotatedAt,
    rotationCount: state.rotationCount,
  };
  if (!state.active || !state.token) {
    return ok({ ...base, shareUrl: null, note: note ?? 'Not shared.' });
  }
  const path = `${SHARE_PATH}?token=${encodeURIComponent(state.token)}`;
  const origin = resolveAppOrigin();
  if (origin) {
    return ok({ ...base, shareUrl: `${origin}${path}`, note });
  }
  return ok({
    ...base,
    shareUrl: null,
    sharePath: path,
    note:
      `${note ? `${note} ` : ''}The API does not know the app console's ` +
      'address, so prefix this path with it (or set PUBLIC_APP_URL on the API).',
  });
}
