import {
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { Tool } from '#mcp';
import type { IConditionallyListedTool } from '#/mcp/interfaces/conditional-listing.interface';
import type { IAuthTokenPayload } from '#/user/auth/domain/auth.types';
import { UserRoleTypes } from '#/user/user/domain';
import { PeerService } from './domain/peer.service';
import { AgentCardService } from './domain/agentCard.service';
import { IDelegationGateway } from './domain/delegation.gateway';
import { PeerErrorCodes, type IAgentPeerView } from './domain/peer.types';

interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

const ok = (value: unknown): ToolResult => ({
  content: [
    {
      type: 'text',
      text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
    },
  ],
});

const err = (text: string): ToolResult => ({
  content: [{ type: 'text', text }],
  isError: true,
});

/** How many delegations `list_agent_delegations` returns when not told. */
const DEFAULT_DELEGATION_LIMIT = 20;
const MAX_DELEGATION_LIMIT = 100;

/**
 * Setting up A2A from the chat, instead of from the console (CLEAN-103).
 *
 * Ranch is configured through an agent: `rancher.tool.ts` already creates
 * agents, restarts them, edits templates and skills. Peers were the hole in
 * that set — the console could connect a colleague and the operator agent
 * could not, so asked to do it, it answered that it had no such tool.
 *
 * Every call goes through `PeerService`, the same service the console calls.
 * Nothing about SSRF, self-address refusal or A2A version and binding vetting
 * is re-implemented here, so an agent cannot reach an address the console
 * would have refused (CLEAN-95, CLEAN-97).
 *
 * Operator agents only. `PeerController` states the invariant this preserves:
 * a runtime delegates through `ask_agent` and must never be able to grant
 * ITSELF a new colleague. An agent flagged `isAdmin` holds an Owner-role
 * service token and acts as a Ranch operator; a plain agent keeps the `Agent`
 * role, and for it these tools do not exist — they are not in its list, and
 * tools/call refuses them by name. That matters beyond tidiness: a document
 * carrying a prompt injection must not be able to talk an ordinary agent into
 * registering an attacker's address and then leaking the conversation to it
 * through a delegation.
 */
@Injectable()
export class PeerAdminTool implements IConditionallyListedTool {
  private readonly logger = new Logger(PeerAdminTool.name);

  constructor(
    private readonly peers: PeerService,
    private readonly cards: AgentCardService,
    private readonly delegations: IDelegationGateway,
  ) {}

  async isListedForRequest(httpRequest: Request): Promise<boolean> {
    return Promise.resolve(isOperator(httpRequest));
  }

  /**
   * The listing hook above already hides these, and tools/call refuses a name
   * that stopped applying — this is the third lock, for the day one of those
   * two is refactored.
   */
  private requireOperator(httpRequest: Request): void {
    if (!isOperator(httpRequest)) {
      throw new ForbiddenException(
        'Managing peers requires the Ranch operator role.',
      );
    }
  }

  // ─── Reading ─────────────────────────────────────────────────────────

  @Tool({
    name: 'list_agent_peers',
    description:
      'Who an agent can delegate to: every peer connected to it, what each ' +
      "peer's card advertises, and whether the running pod has actually " +
      'loaded that set. Directed — it never lists agents that can delegate TO ' +
      'this one. Read this before connecting or removing anything.',
    parameters: z.object({
      agentId: z
        .string()
        .describe('Agent id, e.g. agent-abc123 (list_agents has them)'),
    }),
  })
  async listAgentPeers(
    { agentId }: { agentId: string },
    _context: unknown,
    httpRequest: Request,
  ): Promise<ToolResult> {
    this.requireOperator(httpRequest);
    return this.guard(async () => {
      const [peers, state] = await Promise.all([
        this.peers.list(agentId),
        this.peers.peersState(agentId),
      ]);
      return ok({
        peers: peers.map(toToolPeer),
        // "Connected" and "the running agent can use it" are different facts,
        // and only this one predicts whether a delegation will fire.
        live: state.armed,
        peerListLoadedAt: state.servedAt,
        note: state.armed
          ? 'The running agent holds exactly this peer set.'
          : 'The running agent has NOT loaded this peer set. Delegation stays ' +
            `broken until it restarts — restart_agent with id=${agentId}.`,
      });
    });
  }

  @Tool({
    name: 'list_peer_candidates',
    description:
      'Agents of this Ranch that could become peers of the given agent, each ' +
      'marked with whether it already is one. Use it to turn a name the ' +
      'person said into the id connect_agent_peer needs.',
    parameters: z.object({
      agentId: z.string().describe('The agent that would do the delegating'),
    }),
  })
  async listPeerCandidates(
    { agentId }: { agentId: string },
    _context: unknown,
    httpRequest: Request,
  ): Promise<ToolResult> {
    this.requireOperator(httpRequest);
    return this.guard(async () => ok(await this.peers.candidates(agentId)));
  }

  @Tool({
    name: 'preview_agent_card',
    description:
      'Read a card WITHOUT connecting anything: what that agent tells other ' +
      'agents it can do. Pass `peerAgentId` for an agent of this Ranch, or ' +
      '`url` for an outside one. Worth doing before importing an address the ' +
      'person gave you — you can then tell them what it claims to be, and an ' +
      'address that fails here would have failed the import too.',
    parameters: z.object({
      agentId: z
        .string()
        .describe('The agent that would delegate to it (the caller side)'),
      peerAgentId: z
        .string()
        .optional()
        .describe('Agent id on this Ranch. Mutually exclusive with url.'),
      url: z
        .string()
        .optional()
        .describe(
          'Address of an outside A2A agent — its card URL or its base address',
        ),
      credential: z
        .string()
        .optional()
        .describe('Bearer the outside agent requires, if any'),
    }),
  })
  async previewAgentCard(
    {
      agentId,
      peerAgentId,
      url,
      credential,
    }: {
      agentId: string;
      peerAgentId?: string;
      url?: string;
      credential?: string;
    },
    _context: unknown,
    httpRequest: Request,
  ): Promise<ToolResult> {
    this.requireOperator(httpRequest);
    if (Boolean(peerAgentId) === Boolean(url)) {
      return err('Pass exactly one of peerAgentId (this Ranch) or url.');
    }
    return this.guard(async () =>
      ok(
        peerAgentId
          ? await this.cards.build(peerAgentId)
          : await this.peers.previewByUrl(agentId, url!, credential),
      ),
    );
  }

  @Tool({
    name: 'list_agent_delegations',
    description:
      'What this agent recently handed to its peers: the task, the peer it ' +
      'picked, the reason it gave, how it ended and an excerpt of the reply. ' +
      'This is the evidence for "did it actually ask anyone" — read it before ' +
      'concluding that delegation is broken.',
    parameters: z.object({
      agentId: z.string(),
      limit: z
        .number()
        .int()
        .positive()
        .max(MAX_DELEGATION_LIMIT)
        .optional()
        .describe(`Newest first. Default ${DEFAULT_DELEGATION_LIMIT}.`),
    }),
  })
  async listAgentDelegations(
    { agentId, limit }: { agentId: string; limit?: number },
    _context: unknown,
    httpRequest: Request,
  ): Promise<ToolResult> {
    this.requireOperator(httpRequest);
    return this.guard(async () =>
      ok(
        await this.delegations.listRecent(
          agentId,
          limit ?? DEFAULT_DELEGATION_LIMIT,
        ),
      ),
    );
  }

  // ─── Changing ────────────────────────────────────────────────────────

  @Tool({
    name: 'connect_agent_peer',
    description:
      'Let one agent of this Ranch delegate to another: reads the peer card, ' +
      'mints a credential for exactly this pair and saves the connection. ' +
      'Directed — the peer gains nothing in return; connect the other way too ' +
      'if both should be able to ask. Nothing is saved if the card cannot be ' +
      'read. The agent picks the peer up only on its next restart.',
    parameters: z.object({
      agentId: z.string().describe('The agent that will be doing the asking'),
      peerAgentId: z.string().describe('The agent it will be able to ask'),
    }),
  })
  async connectAgentPeer(
    { agentId, peerAgentId }: { agentId: string; peerAgentId: string },
    _context: unknown,
    httpRequest: Request,
  ): Promise<ToolResult> {
    this.requireOperator(httpRequest);
    return this.guard(async () => {
      const peer = await this.peers.connect(agentId, peerAgentId);
      this.logger.log(
        `Peer connected through MCP: agent=${agentId} peer=${peerAgentId}`,
      );
      return ok(
        `«${peer.peerName}» is now a peer of ${agentId} (connection ${peer.id}). ` +
          `${advertises(peer)} ${restartLine(agentId)}`,
      );
    });
  }

  @Tool({
    name: 'import_external_agent',
    description:
      'Connect an A2A agent outside this Ranch by its address, so the given ' +
      'agent can delegate to it. Reads the card first and saves nothing if it ' +
      'cannot be read, is not A2A 1.0 over JSON-RPC, or points anywhere ' +
      'private. Importing the same address again updates that entry instead ' +
      'of making a second one. An address belonging to this Ranch is refused ' +
      '— use connect_agent_peer for those.',
    parameters: z.object({
      agentId: z.string().describe('The agent that will be doing the asking'),
      url: z
        .string()
        .describe(
          'Card URL or base address, e.g. https://example.com/.well-known/agent-card.json',
        ),
      credential: z
        .string()
        .optional()
        .describe(
          'Bearer that agent requires, if any. Stored write-only and never read back.',
        ),
    }),
  })
  async importExternalAgent(
    {
      agentId,
      url,
      credential,
    }: { agentId: string; url: string; credential?: string },
    _context: unknown,
    httpRequest: Request,
  ): Promise<ToolResult> {
    this.requireOperator(httpRequest);
    return this.guard(async () => {
      const peer = await this.peers.connectByUrl(agentId, url, credential);
      this.logger.log(
        `External peer imported through MCP: agent=${agentId} url=${peer.cardUrl}`,
      );
      return ok(
        `«${peer.peerName}» (${peer.cardUrl}) is now a peer of ${agentId} ` +
          `(connection ${peer.id}). ${advertises(peer)} ${restartLine(agentId)}`,
      );
    });
  }

  @Tool({
    name: 'refresh_agent_peer',
    description:
      "Re-read a peer's card, for when its owner says it can do something " +
      'new. A failed read keeps the card already stored — a stale description ' +
      'beats none. The agent reads peer descriptions when it starts, so new ' +
      'text reaches its model on the next restart.',
    parameters: z.object({
      agentId: z.string(),
      peerId: z
        .string()
        .describe('Connection id from list_agent_peers (not the agent id)'),
    }),
  })
  async refreshAgentPeer(
    { agentId, peerId }: { agentId: string; peerId: string },
    _context: unknown,
    httpRequest: Request,
  ): Promise<ToolResult> {
    this.requireOperator(httpRequest);
    return this.guard(async () => {
      const peer = await this.peers.refresh(agentId, peerId);
      return ok(
        `Card re-read for «${peer.peerName}» (${peer.cardReadAt}). ${advertises(peer)} ` +
          `${agentId} reads peer descriptions when it starts, so the new text ` +
          `reaches it after restart_agent with id=${agentId}.`,
      );
    });
  }

  @Tool({
    name: 'remove_agent_peer',
    description:
      'Disconnect a peer. For a peer of this Ranch the credential issued for ' +
      'the pair stops working — there is no other copy of it. Reversible: ' +
      'connect it again later and a new credential is minted.',
    parameters: z.object({
      agentId: z.string(),
      peerId: z
        .string()
        .describe('Connection id from list_agent_peers (not the agent id)'),
    }),
  })
  async removeAgentPeer(
    { agentId, peerId }: { agentId: string; peerId: string },
    _context: unknown,
    httpRequest: Request,
  ): Promise<ToolResult> {
    this.requireOperator(httpRequest);
    return this.guard(async () => {
      await this.peers.remove(agentId, peerId);
      this.logger.log(
        `Peer removed through MCP: agent=${agentId} connection=${peerId}`,
      );
      return ok(
        `Connection ${peerId} removed from ${agentId}. Until that agent ` +
          'restarts it still believes it has that colleague and will try to ' +
          `ask it — restart_agent with id=${agentId} when the person is ready.`,
      );
    });
  }

  /**
   * The MCP layer turns a thrown error into `isError` text already. This adds
   * the one thing it cannot: what the model should do next. A refusal that
   * names the fix ("that address is ours — connect it by id") is the
   * difference between the agent correcting itself and the agent telling the
   * person it cannot be done.
   */
  private async guard(run: () => Promise<ToolResult>): Promise<ToolResult> {
    try {
      return await run();
    } catch (error) {
      if (!(error instanceof HttpException)) throw error;
      const body = error.getResponse();
      const code =
        typeof body === 'object' && body !== null
          ? (body as { code?: string }).code
          : undefined;
      const hint = code ? NEXT_STEP[code] : undefined;
      return err(hint ? `${error.message} ${hint}` : error.message);
    }
  }
}

/** What to try next, per refusal the peer service can raise. */
const NEXT_STEP: Record<string, string> = {
  [PeerErrorCodes.SelfUrl]:
    'Call list_peer_candidates and connect it with connect_agent_peer instead.',
  [PeerErrorCodes.Self]: 'An agent cannot be its own peer.',
  [PeerErrorCodes.Exists]:
    'It is already connected — list_agent_peers shows it.',
  [PeerErrorCodes.Version]:
    'Nothing was saved. Ranch speaks A2A 1.0 only; ask its owner whether it ' +
    'publishes a 1.0 card.',
  [PeerErrorCodes.Binding]:
    'Nothing was saved. Ranch calls agents over JSON-RPC only.',
  [PeerErrorCodes.UrlInvalid]: 'Nothing was saved. Check the address.',
  [PeerErrorCodes.UrlUnreachable]:
    'Nothing was saved. Tell the person the address did not answer; do not ' +
    'invent what that agent can do.',
  [PeerErrorCodes.CardUnreachable]:
    'Nothing was saved — the card could not be read.',
  [PeerErrorCodes.NotFound]:
    'Check the ids with list_agents and list_agent_peers.',
};

/** Peers as a model needs them: what it is, what it claims, is it usable. */
function toToolPeer(view: IAgentPeerView) {
  return {
    peerId: view.id,
    name: view.peerName,
    origin: view.origin,
    status: view.peerStatus,
    exists: view.peerExists,
    address: view.cardUrl,
    description: view.card?.description ?? '',
    skills: (view.card?.skills ?? []).map((s) => ({
      name: s.name,
      description: s.description,
    })),
    cardReadAt: view.cardReadAt,
  };
}

/**
 * A peer with an empty card is connected and useless: the delegating model
 * matches questions against this text, so "nothing advertised" is the single
 * most useful thing to say back at connect time (CLEAN-95).
 */
function advertises(view: IAgentPeerView): string {
  const skills = view.card?.skills ?? [];
  if (skills.length) {
    return `It advertises: ${skills.map((s) => s.name).join(', ')}.`;
  }
  return view.card?.description
    ? 'Its card lists no skills, so matching leans on its description alone.'
    : 'Warning: its card advertises nothing — no description, no skills. It ' +
        'will only ever be asked when the person names it outright.';
}

function restartLine(agentId: string): string {
  return (
    `It is not live yet: that agent reads its peer list when it starts, so ` +
    `call restart_agent with id=${agentId}. A restart ends whatever ` +
    'conversation that agent is in, so ask the person first if it might be busy.'
  );
}

/** Admin agents hold the Owner role; plain agents hold `Agent` (auth.service). */
function isOperator(httpRequest: Request): boolean {
  const user = (httpRequest as Request & { user?: IAuthTokenPayload }).user;
  return (user?.roles ?? []).includes(UserRoleTypes.Owner);
}
