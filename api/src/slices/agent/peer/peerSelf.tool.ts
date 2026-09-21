import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { Tool } from '#mcp';
import type { IConditionallyListedTool } from '#/mcp/interfaces/conditional-listing.interface';
import { ISettingGateway } from '#/setting/domain';
import { PeerService } from './domain/peer.service';
import { PeerErrorCodes } from './domain/peer.types';
import {
  advertises,
  callerAgentId,
  ok,
  SHARED_HINTS,
  toToolPeer,
  withRefusalAdvice,
  type RefusalHints,
  type ToolResult,
} from './toolSupport';

/**
 * Where the kill switch lives. Absent ⇒ on: Ranch is configured through the
 * chat, and an installation that wants the old behaviour says so explicitly.
 */
export const SELF_SERVICE_SETTING = {
  group: 'a2a',
  name: 'agentSelfService',
} as const;

/**
 * An agent connecting its OWN colleagues (CLEAN-105).
 *
 * The operator set (`peerAdmin.tool.ts`) manages any agent's peers and is
 * gated on the Owner role. That left the common case unserved: a person pastes
 * `https://…/.well-known/agent-card.json` into a chat with an ordinary agent
 * and says "connect this". The agent fetched the file, summarised it, and
 * answered that it had no tool for registering A2A services — correctly, since
 * it could not see the operator tools at all.
 *
 * These tools take no agent id. That is the whole security model: an agent can
 * only ever change its own peer set, never another's, so the worst a prompt
 * injection in a document can do is give the agent reading it a colleague
 * somebody can see and remove in the console. Every address still goes through
 * `PeerService`, so the SSRF checks, the refusal of our own addresses and the
 * A2A 1.0 / JSON-RPC vetting all hold (CLEAN-95, CLEAN-97).
 *
 * An installation that does not want this turns the setting off and the tools
 * vanish from every agent's list.
 */
@Injectable()
export class PeerSelfTool implements IConditionallyListedTool {
  private readonly logger = new Logger(PeerSelfTool.name);

  constructor(
    private readonly peers: PeerService,
    private readonly settings: ISettingGateway,
  ) {}

  async isListedForRequest(httpRequest: Request): Promise<boolean> {
    if (!callerAgentId(httpRequest)) return false;
    return this.selfServiceEnabled();
  }

  /**
   * Default on. A broken or unreachable settings row must not silently strip
   * an agent of tools it had a minute ago, so anything unreadable reads as on
   * — the explicit `false` is the only way to turn this off.
   */
  private async selfServiceEnabled(): Promise<boolean> {
    try {
      const row = await this.settings.findByKey(
        SELF_SERVICE_SETTING.group,
        SELF_SERVICE_SETTING.name,
      );
      if (!row) return true;
      const value = row.value;
      if (typeof value === 'boolean') return value;
      if (typeof value === 'string') {
        return !['false', 'off', '0', 'no'].includes(
          value.trim().toLowerCase(),
        );
      }
      return true;
    } catch (error) {
      this.logger.warn(
        `Could not read the ${SELF_SERVICE_SETTING.group}.${SELF_SERVICE_SETTING.name} setting: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return true;
    }
  }

  /** Every tool answers to this: who is calling, and may they self-serve. */
  private async requireSelf(httpRequest: Request): Promise<string> {
    const agentId = callerAgentId(httpRequest);
    if (!agentId) {
      throw new ForbiddenException(
        'These tools can only be called by an agent runtime.',
      );
    }
    if (!(await this.selfServiceEnabled())) {
      throw new ForbiddenException(
        'Connecting peers from the chat is switched off on this Ranch. Ask ' +
          'the operator to connect it in the console.',
      );
    }
    return agentId;
  }

  // ─── Reading ─────────────────────────────────────────────────────────

  @Tool({
    name: 'list_my_peers',
    description:
      'The colleagues you can delegate to, with what each one advertises. ' +
      'Read this before connecting anything someone asks for — you may have ' +
      'it already — and whenever you need to tell a person who you can reach.',
    parameters: z.object({}),
  })
  async listMyPeers(
    _args: Record<string, never>,
    _context: unknown,
    httpRequest: Request,
  ): Promise<ToolResult> {
    const agentId = await this.requireSelf(httpRequest);
    return withRefusalAdvice(async () => {
      const peers = await this.peers.list(agentId);
      return ok({
        peers: peers.map(toToolPeer),
        note: peers.length
          ? 'Ask any of them with ask_agent, by name.'
          : 'You have no colleagues yet. Connect one with connect_my_peer ' +
            '(an agent of this Ranch) or import_my_peer_by_address (anything ' +
            'outside it).',
      });
    }, SELF_HINTS);
  }

  @Tool({
    name: 'list_ranch_agents',
    description:
      'The other agents living on this Ranch, each marked with whether it is ' +
      'already your colleague. Use it to turn a name a person said into the ' +
      'id connect_my_peer needs.',
    parameters: z.object({}),
  })
  async listRanchAgents(
    _args: Record<string, never>,
    _context: unknown,
    httpRequest: Request,
  ): Promise<ToolResult> {
    const agentId = await this.requireSelf(httpRequest);
    return withRefusalAdvice(
      async () => ok(await this.peers.candidates(agentId)),
      SELF_HINTS,
    );
  }

  @Tool({
    name: 'preview_agent_card_by_address',
    description:
      'Read another agent’s A2A card from its address WITHOUT connecting ' +
      'anything — its name, what it says it does, the skills it publishes. ' +
      'When a person gives you a link ending in /.well-known/agent-card.json, ' +
      'or hands you any address calling it an agent, an A2A agent or a card, ' +
      'this is the tool: that link is an agent, not a document to download ' +
      'and summarise. Read it, tell the person what it claims to be, then ' +
      'offer to connect it with import_my_peer_by_address.',
    parameters: z.object({
      url: z
        .string()
        .describe(
          'The address as the person gave it — card URL or base address',
        ),
      credential: z
        .string()
        .optional()
        .describe('Bearer that agent requires, if the person supplied one'),
    }),
  })
  async previewAgentCardByAddress(
    { url, credential }: { url: string; credential?: string },
    _context: unknown,
    httpRequest: Request,
  ): Promise<ToolResult> {
    const agentId = await this.requireSelf(httpRequest);
    return withRefusalAdvice(
      async () => ok(await this.peers.previewByUrl(agentId, url, credential)),
      SELF_HINTS,
    );
  }

  // ─── Changing your own colleagues ────────────────────────────────────

  @Tool({
    name: 'connect_my_peer',
    description:
      'Take an agent of this Ranch as your colleague, so you can hand it ' +
      'tasks with ask_agent. Directed: it gains nothing in return. Nothing is ' +
      'saved if its card cannot be read. Tell the person what it can do once ' +
      'it is connected — the reply tells you.',
    parameters: z.object({
      peerAgentId: z
        .string()
        .describe('Agent id from list_ranch_agents, e.g. agent-abc123'),
    }),
  })
  async connectMyPeer(
    { peerAgentId }: { peerAgentId: string },
    _context: unknown,
    httpRequest: Request,
  ): Promise<ToolResult> {
    const agentId = await this.requireSelf(httpRequest);
    return withRefusalAdvice(async () => {
      const hadPeers = (await this.peers.list(agentId)).length > 0;
      const peer = await this.peers.connect(agentId, peerAgentId);
      this.logger.log(
        `Agent connected its own peer: agent=${agentId} peer=${peerAgentId}`,
      );
      return ok(
        `«${peer.peerName}» is now your colleague. ${advertises(peer)} ` +
          `${usabilityLine(peer.peerName, hadPeers)}`,
      );
    }, SELF_HINTS);
  }

  @Tool({
    name: 'import_my_peer_by_address',
    description:
      'Take an A2A agent from outside this Ranch as your colleague, by its ' +
      'address. This is what a pasted /.well-known/agent-card.json link is ' +
      'for: when someone says "connect this", "подключи" or "add this agent" ' +
      'with an address, call this — do not settle for describing the file. ' +
      'The card is read first and nothing is saved if it cannot be read, is ' +
      'not A2A 1.0 over JSON-RPC, or resolves to a private address. Giving ' +
      'the same address twice updates that colleague instead of duplicating ' +
      'it. An address belonging to this Ranch is refused — those go through ' +
      'connect_my_peer.',
    parameters: z.object({
      url: z
        .string()
        .describe(
          'Card URL or base address, e.g. https://example.com/.well-known/agent-card.json',
        ),
      credential: z
        .string()
        .optional()
        .describe(
          'Bearer that agent requires, if the person supplied one. Stored ' +
            'write-only and never read back.',
        ),
    }),
  })
  async importMyPeerByAddress(
    { url, credential }: { url: string; credential?: string },
    _context: unknown,
    httpRequest: Request,
  ): Promise<ToolResult> {
    const agentId = await this.requireSelf(httpRequest);
    return withRefusalAdvice(async () => {
      const hadPeers = (await this.peers.list(agentId)).length > 0;
      const peer = await this.peers.connectByUrl(agentId, url, credential);
      this.logger.log(
        `Agent imported its own external peer: agent=${agentId} url=${peer.cardUrl}`,
      );
      return ok(
        `«${peer.peerName}» (${peer.cardUrl}) is now your colleague. ` +
          `${advertises(peer)} ${usabilityLine(peer.peerName, hadPeers)}`,
      );
    }, SELF_HINTS);
  }

  @Tool({
    name: 'remove_my_peer',
    description:
      'Drop one of your colleagues. For an agent of this Ranch the credential ' +
      'issued for the pair stops working. Reversible — connect it again later.',
    parameters: z.object({
      peerId: z
        .string()
        .describe('Connection id from list_my_peers (not the agent id)'),
    }),
  })
  async removeMyPeer(
    { peerId }: { peerId: string },
    _context: unknown,
    httpRequest: Request,
  ): Promise<ToolResult> {
    const agentId = await this.requireSelf(httpRequest);
    return withRefusalAdvice(async () => {
      await this.peers.remove(agentId, peerId);
      this.logger.log(
        `Agent removed its own peer: agent=${agentId} connection=${peerId}`,
      );
      const left = await this.peers.list(agentId);
      return ok(
        left.length
          ? `Removed. You still have ${left.length} colleague${left.length === 1 ? '' : 's'}: ` +
              `${left.map((p) => `«${p.peerName}»`).join(', ')}.`
          : 'Removed — that was your last colleague. Your ask_agent tool will ' +
              'be gone the next time you start.',
      );
    }, SELF_HINTS);
  }
}

/** What to try next, in the vocabulary an agent uses about itself. */
const SELF_HINTS: RefusalHints = {
  ...SHARED_HINTS,
  [PeerErrorCodes.SelfUrl]:
    'That address is an agent of this Ranch. Find it in list_ranch_agents and ' +
    'use connect_my_peer.',
  [PeerErrorCodes.Self]: 'You cannot be your own colleague.',
  [PeerErrorCodes.Exists]:
    'You already have it — list_my_peers shows it. Tell the person it is ' +
    'already connected.',
  [PeerErrorCodes.NotFound]: 'Check the ids with list_my_peers.',
};

/**
 * Whether the agent can use the colleague it just gained, and it genuinely
 * depends on whether it had any before. `ask_agent` is listed only for an
 * agent that had peers when it booted, and the roster inside its description
 * is captured then — but `delegation.service.run` resolves the peer against
 * the live rows. So a second colleague is reachable at once; a first one is
 * not reachable at all until the agent restarts (CLEAN-105).
 */
function usabilityLine(peerName: string, hadPeers: boolean): string {
  return hadPeers
    ? `You can hand «${peerName}» a task right now: ask_agent, peer: ` +
        `"${peerName}". (Your own list of colleagues still shows the older ` +
        'set until you are restarted, so go by this reply, not by that list.)'
    : `Say this to the person: «${peerName}» is connected, but you cannot ask ` +
        'it anything until you are restarted — you had no colleagues when you ' +
        'started, so you were given no ask_agent tool. They can restart you ' +
        'from your page in the console (the banner above the tabs, or the ' +
        'Peers tab). Nothing is lost by waiting; the colleague stays.';
}
