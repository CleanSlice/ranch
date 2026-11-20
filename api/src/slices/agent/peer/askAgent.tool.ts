import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { Tool, ToolAudience, ToolTopics } from '#mcp';
import type { Request } from 'express';
import type { IAuthTokenPayload } from '#/user/auth/domain/auth.types';
import type { IDynamicallyDescribedTool } from '#/mcp/interfaces/dynamic-description.interface';
import type { IConditionallyListedTool } from '#/mcp/interfaces/conditional-listing.interface';
import { callerParty, callerTurnClient } from '#/mcp/tooling';
import { IPeerGateway } from './domain/peer.gateway';
import { PeerAccessService } from './domain/peerAccess';
import { rosterFor, type IRosterEntry } from './domain/peerRoster';
import { DelegationService } from './domain/delegation.service';
import { A2aServerService } from './domain/a2a.server.service';
import { causeText } from './domain/delegationStep';
import { DelegationStatuses, hashPeerIds } from './domain/peer.types';

interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

const ok = (text: string): ToolResult => ({
  content: [{ type: 'text', text }],
});

const err = (text: string): ToolResult => ({
  content: [{ type: 'text', text }],
  isError: true,
});

/**
 * Read by a model that has never seen this product. Every sentence earns its
 * place: when to call it, when NOT to (the expensive mistake is treating a
 * colleague as a first resort), that the peer sees none of this conversation,
 * and that `reason` is shown to a person — which is what makes the visible
 * step worth reading rather than a restatement of the task.
 */
const BASE_DESCRIPTION =
  'Ask one of your connected peer agents to do a task you cannot do yourself, ' +
  'then use their reply in your answer and say it came from them. Call this ' +
  "when the user asks about something a peer's skills cover and your own " +
  'tools do not. Before you answer that you do not know, cannot help, or ' +
  'lack a tool: check your peers below. If any peer’s description or ' +
  'skills plausibly covers the question, call this tool first — «I ' +
  'don’t know» without having asked a matching peer is a wrong ' +
  'answer. When the user names a peer or asks about a peer’s own data, ' +
  'always ask that peer. Do NOT call it for anything you can do yourself ' +
  '— a peer is a colleague, not a first resort. The peer does not see ' +
  'this conversation, so send it a self-contained task in plain text. If ' +
  'several independent questions go to different peers, call this tool once ' +
  'for each in the same turn. Give a one-line `reason` naming the skill that ' +
  'made you pick that peer: it is shown to the person watching.';

const NO_PEERS_DESCRIPTION =
  'Ask one of your connected peer agents to do a task you cannot do yourself. ' +
  'You currently have no peers connected, so do not call this tool.';

const DO_NOT_GUESS =
  'Tell the user you could not get this from that agent; do not answer on its behalf.';

const schema = z.object({
  peer: z
    .string()
    .describe(
      'Peer id from the list in this tool description, or its exact name',
    ),
  task: z
    .string()
    .min(1)
    .describe(
      'The task, written so it stands alone — the peer cannot see this conversation',
    ),
  reason: z
    .string()
    .min(1)
    .describe(
      'One line: why this peer. Name the skill that matched. Shown to the user.',
    ),
  context_id: z
    .string()
    .optional()
    .describe(
      'To continue an earlier exchange with the same peer in this turn, pass the context_id from its previous reply',
    ),
});

/**
 * Delegation, served to the agent runtime through the MCP channel it already
 * uses (CLEAN-74). Living in the API rather than in the runtime image is what
 * lets peers ship without rebuilding a single agent.
 *
 * Every agent gets the tool, and what is in it depends on who the turn is
 * for (CLEAN-236): the roster in the description, and the peers a call may
 * name, are the connections that serve that caller (`peerAccess.ts`). A peer
 * the caller does not reach is not there to be named, described or asked,
 * unless its connection is open to visitors; then it is `Colleague N`, with
 * its skills and without its name.
 */
@ToolAudience('agent')
@Injectable()
export class AskAgentTool
  implements IDynamicallyDescribedTool, IConditionallyListedTool
{
  private readonly logger = new Logger(AskAgentTool.name);

  constructor(
    private readonly peers: IPeerGateway,
    private readonly delegations: DelegationService,
    private readonly a2aServer: A2aServerService,
    private readonly access: PeerAccessService,
  ) {}

  /**
   * The peers this call's caller is served by. The serve-state is recorded
   * from the whole peer set on the way: "has the running pod asked for its
   * peers" is a fact about the agent, not about who it is talking to.
   */
  private async rosterOf(
    agentId: string,
    httpRequest: Request,
  ): Promise<IRosterEntry[]> {
    const [connections, viewer] = await Promise.all([
      this.peers.listByAgent(agentId),
      this.access.viewerOf(callerParty(httpRequest), agentId),
    ]);
    await this.recordServed(agentId, connections);
    return rosterFor(connections, viewer);
  }

  /** Best-effort serve-state write; the tool list must survive its failure. */
  private async recordServed(
    agentId: string,
    connections: { id: string }[],
  ): Promise<void> {
    try {
      await this.peers.recordPeersServed(
        agentId,
        hashPeerIds(connections.map((c) => c.id)),
      );
    } catch (err) {
      this.logger.warn(
        `Could not record peers-served state for agent=${agentId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * An agent with no peers for this caller must not see this tool at all. A
   * description saying "you have none" would still be an advertisement for
   * colleagues that do not exist, and models act on tool lists, not on
   * caveats inside them.
   */
  async isListedForRequest(httpRequest: Request): Promise<boolean> {
    const agentId = extractAgentId(httpRequest);
    if (!agentId) return false;
    // This IS the moment the running pod learns its peer set — recorded in
    // `rosterOf`, even when the set is empty, so the console can say "armed"
    // honestly (CLEAN-95). Best-effort: an indicator must never break a
    // tools/list.
    return (await this.rosterOf(agentId, httpRequest)).length > 0;
  }

  async describeForRequest(httpRequest: Request): Promise<string | null> {
    const agentId = extractAgentId(httpRequest);
    if (!agentId) return null;

    const roster = await this.rosterOf(agentId, httpRequest);
    if (roster.length === 0) return null;

    return [
      BASE_DESCRIPTION,
      '',
      'Your peers:',
      ...roster.map((entry) => describePeer(entry)),
    ].join('\n');
  }

  @Tool({
    name: 'ask_agent',
    topic: ToolTopics.Peers,
    effect: 'write',
    title: 'Ask a peer agent',
    template: 'Ask your peer «name» to «task»',
    description: NO_PEERS_DESCRIPTION,
    parameters: schema,
  })
  async ask(
    args: unknown,
    _context: unknown,
    httpRequest: Request,
  ): Promise<ToolResult> {
    const agentId = extractAgentId(httpRequest);
    if (!agentId) {
      return err('ask_agent can only be called by an agent runtime.');
    }

    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return err(
        `Invalid arguments: ${issue.path.join('.') || 'input'} — ${issue.message}`,
      );
    }

    const outcome = await this.delegations.run(
      {
        callerAgentId: agentId,
        party: callerParty(httpRequest),
        peer: parsed.data.peer,
        task: parsed.data.task,
        reason: parsed.data.reason,
        contextId: parsed.data.context_id,
        // This agent may itself be serving a delegation right now. Carrying
        // that chain forward is what lets the far end refuse a loop it can see
        // and this end cannot. A call that states its hand-over brings the
        // chain itself (the party); this is for a runtime that cannot.
        inboundChain: this.a2aServer.currentChain(agentId),
        // The conversation the call belongs to, when the runtime said.
        turnClient: callerTurnClient(httpRequest),
      },
      this.a2aServer.timeoutMs,
    );

    if (outcome.kind === 'no_match') {
      const names = outcome.peers.length
        ? outcome.peers.map((n) => `"${n}"`).join(', ')
        : 'none';
      return err(
        `No peer matches "${parsed.data.peer}". Your peers are: ${names}.`,
      );
    }

    const took = `${(outcome.durationMs / 1000).toFixed(1)}s`;
    // «Name» for a peer the caller reaches; "a colleague" for one that serves
    // them through a connection open to visitors.
    const who = outcome.masked ? outcome.peerName : `«${outcome.peerName}»`;
    const Who = who.charAt(0).toUpperCase() + who.slice(1);

    if (outcome.status === DelegationStatuses.Answered) {
      if (!outcome.text) {
        // Said explicitly: an empty tool result reads to a model like "no
        // news", and it will fill the gap itself (CLEAN-97).
        return ok(
          `${Who} answered (context_id: ${outcome.contextId}, ${took}), but the reply was empty — no text, data or links. Tell the user it returned nothing; do not invent what it might have said.`,
        );
      }
      return ok(
        `Reply from ${who} (context_id: ${outcome.contextId}, ${took}):\n\n${outcome.text}`,
      );
    }

    if (outcome.status === DelegationStatuses.Rejected) {
      return err(
        `${Who} refused the task: ${outcome.cause ?? causeText(outcome.errorCode ?? null)}. ${DO_NOT_GUESS}`,
      );
    }

    return err(
      `Could not reach ${who}: ${causeText(outcome.errorCode ?? null)}. ${DO_NOT_GUESS}`,
    );
  }
}

/**
 * One line per peer, carrying exactly what a choice needs: what it is, how to
 * name it, and what its card claims it can do. A masked peer has a label, the
 * connection id as its handle and its skills; the description is left out by
 * rule, since the default one is the agent's name.
 */
function describePeer(entry: IRosterEntry): string {
  const card = entry.row.cardSnapshot;
  const description = entry.masked ? '' : (card?.description ?? '');
  const skills = (card?.skills ?? [])
    .map((s) => `${s.name} (${s.description})`)
    .join('; ');

  // External peers have no agent id here; the connection id names them just
  // as reliably, and it is all a masked peer is known by (CLEAN-95).
  const parts = [`- "${entry.label}" (peer: ${entry.handle})`];
  if (description) parts.push(` — ${description}`);
  if (skills) parts.push(` Skills: ${skills}`);
  return parts.join('');
}

/** Agent service tokens carry `sub = agent:<id>`; anything else is not an agent. */
function extractAgentId(httpRequest: Request): string | null {
  const user = (httpRequest as Request & { user?: IAuthTokenPayload }).user;
  const sub = user?.sub ?? '';
  if (!sub.startsWith('agent:')) return null;
  return sub.slice('agent:'.length);
}
