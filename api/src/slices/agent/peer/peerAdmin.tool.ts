import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { Tool, ToolAudience, ToolTopics } from '#mcp';
import {
  callerIsOperator,
  callerHoldsManageTools,
  callerPerson,
  CONFIRM_SENTENCE,
  confirmed,
  manageCaller,
  operatorOnly,
  ownerOnlyRefusal,
  PERSON_REFUSAL,
} from '#/mcp/tooling';
import type { IAgentData } from '#/agent/agent/domain/agent.types';
import { AgentPermissionService } from '#/agent/agent/domain/agentPermission.service';
import type { IConditionallyListedTool } from '#/mcp/interfaces/conditional-listing.interface';
import { PeerService } from './domain/peer.service';
import { PeerErrorCodes } from './domain/peer.types';
import {
  advertises,
  err,
  ok,
  SHARED_HINTS,
  toToolPeer,
  withRefusalAdvice,
  type RefusalHints,
  type ToolResult,
} from './toolSupport';

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
 *
 * `manage-agent` (CLEAN-232): every tool here names the agent that does the
 * asking, and runs only when the caller may manage that agent (`guard`
 * below). A plain agent's token manages nothing, so the invariant above
 * holds as before. The Ranch admin agent's own peers are the Owner's.
 *
 * A connection has two ends (CLEAN-236). The agent that asks is the one the
 * caller must manage. The other end is asked about in `PeerService`, by the
 * one rule every entry point shares (`peerAccess.ts`): a connection to an
 * agent of this Ranch exists for a person only when they reach that agent.
 * So these tools list, connect, re-read and remove only what the person the
 * call is made for may see, and a peer they do not reach answers as one that
 * does not exist.
 *
 * A person is required. The Ranch admin agent on its own schedule holds
 * operator power and used to run these for itself; a turn nobody asked for
 * has no person whose reach could be asked, so it changes and inspects
 * nobody's peers.
 */
@ToolAudience('manage-agent')
@Injectable()
export class PeerAdminTool implements IConditionallyListedTool {
  private readonly logger = new Logger(PeerAdminTool.name);

  constructor(
    private readonly peers: PeerService,
    private readonly permission: AgentPermissionService,
  ) {}

  async isListedForRequest(httpRequest: Request): Promise<boolean> {
    return Promise.resolve(
      callerHoldsManageTools(httpRequest) && callerPerson(httpRequest) !== null,
    );
  }

  // ─── Reading ─────────────────────────────────────────────────────────

  @Tool({
    name: 'list_agent_peers',
    topic: ToolTopics.Peers,
    effect: 'read',
    title: "List an agent's peers",
    template: 'Which peers does the agent «name» have?',
    description:
      'Who an agent can delegate to: every peer connected to it, what each ' +
      "peer's card advertises, who connected it, whom it serves, and " +
      'whether the running pod has actually loaded that set. Directed — it ' +
      'never lists agents that can delegate TO this one. A peer the person ' +
      'has no access to is not listed. Read this before connecting or ' +
      'removing anything.',
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
    return this.guard(httpRequest, agentId, async () => {
      const [peers, state] = await Promise.all([
        this.peers.list(agentId, manageCaller(httpRequest)),
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
    topic: ToolTopics.Peers,
    effect: 'read',
    title: 'Agents that can become peers',
    template: 'Which agents could «name» delegate to?',
    description:
      'Agents of this Ranch that could become peers of the given agent: the ' +
      'ones the person has access to, each marked with whether it already ' +
      'is one. Use it to turn a name the person said into the id ' +
      'connect_agent_peer needs.',
    parameters: z.object({
      agentId: z.string().describe('The agent that would do the delegating'),
    }),
  })
  async listPeerCandidates(
    { agentId }: { agentId: string },
    _context: unknown,
    httpRequest: Request,
  ): Promise<ToolResult> {
    return this.guard(httpRequest, agentId, async () =>
      // Only agents the person could connect: the ones they reach.
      ok(await this.peers.candidates(agentId, manageCaller(httpRequest))),
    );
  }

  @Tool({
    name: 'preview_agent_card',
    topic: ToolTopics.Peers,
    effect: 'read',
    title: "Preview an agent's card",
    template: 'Show the A2A card of the agent «name»',
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
    if (Boolean(peerAgentId) === Boolean(url)) {
      return err('Pass exactly one of peerAgentId (this Ranch) or url.');
    }
    return this.guard(httpRequest, agentId, async () =>
      ok(
        peerAgentId
          ? await this.peers.previewAgent(
              agentId,
              peerAgentId,
              manageCaller(httpRequest),
            )
          : await this.peers.previewByUrl(agentId, url!, credential),
      ),
    );
  }

  @Tool({
    name: 'list_agent_delegations',
    topic: ToolTopics.Peers,
    effect: 'read',
    title: 'Recent delegations',
    template: 'What did the agent «name» delegate recently?',
    description:
      'What this agent recently handed to its peers: the task, the peer it ' +
      'picked, the reason it gave, how it ended and an excerpt of the reply. ' +
      'This is the evidence for "did it actually ask anyone" — read it before ' +
      'concluding that delegation is broken. Tasks handed to a peer the ' +
      'person has no access to are not listed.',
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
    return this.guard(httpRequest, agentId, async () =>
      ok(
        await this.peers.recentDelegations(
          agentId,
          manageCaller(httpRequest),
          limit ?? DEFAULT_DELEGATION_LIMIT,
        ),
      ),
    );
  }

  // ─── Changing ────────────────────────────────────────────────────────

  @Tool({
    name: 'connect_agent_peer',
    topic: ToolTopics.Peers,
    effect: 'write',
    title: 'Connect a peer',
    template: 'Connect the agent «peer» as a peer of «name»',
    description:
      'Let one agent of this Ranch delegate to another: reads the peer card, ' +
      'mints a credential for exactly this pair and saves the connection. ' +
      'Directed — the peer gains nothing in return; connect the other way too ' +
      'if both should be able to ask. Nothing is saved if the card cannot be ' +
      'read. The peer then serves the people who have access to it; ' +
      'set_agent_peer_visitors opens it to everybody who talks to the ' +
      'agent. The agent picks the peer up only on its next restart.',
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
    return this.guard(httpRequest, agentId, async () => {
      const hadPeers = await this.hadPeers(httpRequest, agentId);
      const peer = await this.peers.connect(
        agentId,
        peerAgentId,
        manageCaller(httpRequest),
      );
      this.logger.log(
        `Peer connected through MCP: agent=${agentId} peer=${peerAgentId}`,
      );
      return ok(
        `«${peer.peerName}» is now a peer of ${agentId} (connection ${peer.id}). ` +
          `${advertises(peer)} ${restartLine(agentId, hadPeers)}`,
      );
    });
  }

  @Tool({
    name: 'import_external_agent',
    topic: ToolTopics.Peers,
    effect: 'write',
    title: 'Import an external A2A agent',
    template: 'Import the external agent at «url» as a peer of «name»',
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
    return this.guard(httpRequest, agentId, async (agent) => {
      const refusal = operatorOnly(httpRequest, agent, OUTSIDE_PEER);
      if (refusal) return refusal;
      const hadPeers = await this.hadPeers(httpRequest, agentId);
      const peer = await this.peers.connectByUrl(
        agentId,
        url,
        credential,
        manageCaller(httpRequest),
      );
      this.logger.log(
        `External peer imported through MCP: agent=${agentId} url=${peer.cardUrl}`,
      );
      return ok(
        `«${peer.peerName}» (${peer.cardUrl}) is now a peer of ${agentId} ` +
          `(connection ${peer.id}). ${advertises(peer)} ` +
          `${restartLine(agentId, hadPeers)}`,
      );
    });
  }

  @Tool({
    name: 'import_agent_from_card',
    topic: ToolTopics.Peers,
    effect: 'write',
    title: 'Import an agent from its card',
    template: 'Connect this agent to «name» — here is its card',
    description:
      'Connect an outside agent from its card itself, for a card nobody has ' +
      'published at an address: the person pastes the JSON or YAML, or ' +
      'attaches the file. Checked exactly like an imported address, and ' +
      'identified by the address the card names — so importing the same ' +
      'agent later by URL updates this entry instead of duplicating it. The ' +
      'address inside the card is what delegations will call, so a card ' +
      'pointing at localhost or a private network is refused.',
    parameters: z.object({
      agentId: z.string().describe('The agent that will be doing the asking'),
      card: z
        .string()
        .min(1)
        .describe('The agent card, JSON or YAML, exactly as it was given'),
      credential: z
        .string()
        .optional()
        .describe(
          'Bearer that agent requires, if any. Stored write-only and never ' +
            'read back.',
        ),
    }),
  })
  async importAgentFromCard(
    {
      agentId,
      card,
      credential,
    }: { agentId: string; card: string; credential?: string },
    _context: unknown,
    httpRequest: Request,
  ): Promise<ToolResult> {
    return this.guard(httpRequest, agentId, async (agent) => {
      const refusal = operatorOnly(httpRequest, agent, OUTSIDE_PEER);
      if (refusal) return refusal;
      const hadPeers = await this.hadPeers(httpRequest, agentId);
      const peer = await this.peers.connectByCard(
        agentId,
        card,
        credential,
        manageCaller(httpRequest),
      );
      this.logger.log(
        `Peer imported from a pasted card through MCP: agent=${agentId} url=${peer.cardUrl}`,
      );
      return ok(
        `«${peer.peerName}» is now a peer of ${agentId} (connection ` +
          `${peer.id}), from the card given. Delegations go to ` +
          `${peer.cardUrl}. ${advertises(peer)} ${restartLine(agentId, hadPeers)}`,
      );
    });
  }

  @Tool({
    name: 'refresh_agent_peer',
    topic: ToolTopics.Peers,
    effect: 'write',
    title: "Refresh a peer's card",
    template: 'Refresh the card of the peer «peer» on the agent «name»',
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
    return this.guard(httpRequest, agentId, async () => {
      const peer = await this.peers.refresh(
        agentId,
        peerId,
        manageCaller(httpRequest),
      );
      return ok(
        `Card re-read for «${peer.peerName}» (${peer.cardReadAt}). ${advertises(peer)} ` +
          `${agentId} reads peer descriptions when it starts, so the new text ` +
          `reaches it after restart_agent with id=${agentId}.`,
      );
    });
  }

  @Tool({
    name: 'remove_agent_peer',
    topic: ToolTopics.Peers,
    effect: 'write',
    title: 'Remove a peer',
    template: 'Remove the peer «peer» from the agent «name»',
    destructive: true,
    description:
      'Disconnect a peer. For a peer of this Ranch the credential issued for ' +
      'the pair stops working — there is no other copy of it. Reversible: ' +
      'connect it again later and a new credential is minted. ' +
      CONFIRM_SENTENCE,
    parameters: z.object({
      agentId: z.string(),
      peerId: z
        .string()
        .describe('Connection id from list_agent_peers (not the agent id)'),
      confirm: z
        .boolean()
        .describe('Set true only after the person confirmed in the chat.'),
    }),
  })
  async removeAgentPeer(
    args: { agentId: string; peerId: string; confirm?: boolean },
    _context: unknown,
    httpRequest: Request,
  ): Promise<ToolResult> {
    const { agentId, peerId } = args;
    const refusal = confirmed(
      args,
      `disconnect peer ${peerId} from agent ${agentId}`,
    );
    if (refusal) return refusal;
    return this.guard(httpRequest, agentId, async () => {
      await this.peers.remove(agentId, peerId, manageCaller(httpRequest));
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

  @Tool({
    name: 'set_agent_peer_visitors',
    topic: ToolTopics.Peers,
    effect: 'write',
    title: 'Open a peer to visitors',
    template: 'Open the peer «peer» of «name» to visitors',
    destructive: true,
    description:
      'Decide whom a peer of this Ranch serves through the given agent. ' +
      'Closed (the default): the people who have access to the peer ' +
      'themselves. Open: everybody who talks to the agent, people with no ' +
      'access to the peer and anonymous visitors included; to them it is ' +
      'shown as "a colleague", without its name. Opening publishes the peer, ' +
      'so the person must manage both agents. Not for a peer outside the ' +
      'Ranch. ' +
      CONFIRM_SENTENCE,
    parameters: z.object({
      agentId: z.string().describe('The agent that does the asking'),
      peerId: z
        .string()
        .describe('Connection id from list_agent_peers (not the agent id)'),
      open: z
        .boolean()
        .describe('true to open it to visitors, false to close it again'),
      confirm: z
        .boolean()
        .describe('Set true only after the person confirmed in the chat.'),
    }),
  })
  async setAgentPeerVisitors(
    args: { agentId: string; peerId: string; open: boolean; confirm?: boolean },
    _context: unknown,
    httpRequest: Request,
  ): Promise<ToolResult> {
    const { agentId, peerId, open } = args;
    const refusal = confirmed(
      args,
      open
        ? `let everybody who talks to agent ${agentId}, visitors included, be served by its peer ${peerId}`
        : `close peer ${peerId} of agent ${agentId} to visitors, so that it serves only the people who have access to it`,
    );
    if (refusal) return refusal;
    return this.guard(httpRequest, agentId, async () => {
      const peer = await this.peers.setVisitors(
        agentId,
        peerId,
        open,
        manageCaller(httpRequest),
      );
      this.logger.log(
        `Peer ${open ? 'opened to' : 'closed to'} visitors through MCP: agent=${agentId} connection=${peerId}`,
      );
      return ok(
        open
          ? `«${peer.peerName}» now serves everybody who talks to ${agentId}, ` +
              'and is shown without its name to those who have no access to it.'
          : `«${peer.peerName}» now serves only the people who have access ` +
              `to it through ${agentId}.`,
      );
    });
  }

  /**
   * Whether the agent has a peer already, as far as this person can see:
   * what decides the restart advice of a connect. Asked through the same
   * rule as everything else, so a peer hidden from them is not given away by
   * the wording of the reply.
   */
  private async hadPeers(
    httpRequest: Request,
    agentId: string,
  ): Promise<boolean> {
    return (
      (await this.peers.list(agentId, manageCaller(httpRequest))).length > 0
    );
  }

  /**
   * Every tool here acts for one agent, the one doing the asking. The call
   * goes ahead only for a person (see the class comment) who may manage that
   * agent (CLEAN-232); for one they may not, it fails exactly as it does for
   * an agent that does not exist, through the same refusal advice, so the
   * two cannot be told apart. The peer at the other end is `PeerService`'s
   * to ask about.
   */
  private guard(
    httpRequest: Request,
    agentId: string,
    run: (agent: IAgentData) => Promise<ToolResult>,
  ): Promise<ToolResult> {
    return withRefusalAdvice(async () => {
      if (callerPerson(httpRequest) === null) {
        throw new ForbiddenException(PERSON_REFUSAL);
      }
      const agent = await this.permission.manageable(
        manageCaller(httpRequest),
        agentId,
      );
      if (!agent) {
        // The Ranch assistant, for a person who is talking to it: the one
        // refusal that says who manages the agent (CLEAN-263).
        const ownerOnly = ownerOnlyRefusal(httpRequest, agentId);
        if (ownerOnly) return ownerOnly;
        throw new NotFoundException({
          code: PeerErrorCodes.NotFound,
          message: 'Agent not found',
        });
      }
      return run(agent);
    }, hintsFor(httpRequest));
  }
}

/**
 * A peer outside the Ranch added by whoever manages the agent serves
 * everybody who talks to it (`PeerService.externalAudience`): it is where
 * their questions leave the installation, and its card is text in front of
 * the agent on every turn. The address is vetted either way
 * (`assertPublicPeerAddress`, `assertResolvesPublic`, `vetExternalCard`);
 * who decides it for everybody is the point, and that is not a person the
 * assistant setting let in (CLEAN-254). Their own outside colleague is
 * `import_my_peer_by_address`, in the chat with that agent.
 */
const OUTSIDE_PEER =
  'Connecting an agent outside this Ranch for everybody who talks to this agent';

/**
 * What to try next, in the vocabulary of this tool set. Per caller: the
 * not-found advice names `list_agents` only for a caller who has it
 * (CLEAN-232). A User managing their own agents reaches these tools without
 * it, and is told only that nothing they manage answers to that id.
 */
function hintsFor(httpRequest: Request): RefusalHints {
  return {
    ...SHARED_HINTS,
    [PeerErrorCodes.SelfUrl]:
      'Call list_peer_candidates and connect it with connect_agent_peer instead.',
    [PeerErrorCodes.Exists]:
      'It is already connected — list_agent_peers shows it.',
    [PeerErrorCodes.Forbidden]:
      'It is listed for this person, and it is not theirs to change. Tell ' +
      'them who can: whoever connected it, or the Ranch owner.',
    [PeerErrorCodes.NotFound]: callerIsOperator(httpRequest)
      ? 'Check the ids with list_agents and list_agent_peers.'
      : 'There is no such agent or connection among the ones this person ' +
        'manages.',
  };
}

/**
 * What a restart is actually for, which depends on whether this was the
 * agent's first colleague. `ask_agent` is listed only for an agent that had
 * peers when it booted, and its roster of colleagues is captured then too —
 * but `delegation.service.run` resolves the peer against the live rows. So an
 * agent that already had peers can reach a new one the moment someone names
 * it; an agent getting its first one cannot delegate at all until it restarts
 * (CLEAN-105).
 */
function restartLine(agentId: string, hadPeers: boolean): string {
  return hadPeers
    ? `It can be reached already — delegation resolves peers by name when the ` +
        `call is made. What is stale is that agent's own roster of colleagues, ` +
        `captured when it started: until restart_agent with id=${agentId} it ` +
        `will only ask this peer if someone names it, never by topic.`
    : `This is that agent's FIRST colleague, so it has no ask_agent tool yet — ` +
        `that is decided when it starts. It cannot delegate at all until ` +
        `restart_agent with id=${agentId}. A restart ends whatever conversation ` +
        `that agent is in, so ask the person first if it might be busy.`;
}
