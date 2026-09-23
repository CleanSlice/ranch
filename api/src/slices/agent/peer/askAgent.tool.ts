import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { Tool, ToolTopics } from '#mcp';
import type { Request } from 'express';
import type { IAuthTokenPayload } from '#/user/auth/domain/auth.types';
import type { IDynamicallyDescribedTool } from '#/mcp/interfaces/dynamic-description.interface';
import type { IConditionallyListedTool } from '#/mcp/interfaces/conditional-listing.interface';
import { IPeerGateway } from './domain/peer.gateway';
import { DelegationService } from './domain/delegation.service';
import { A2aServerService } from './domain/a2a.server.service';
import { causeText } from './domain/delegationStep';
import {
  DelegationStatuses,
  hashPeerIds,
  type IAgentPeerData,
} from './domain/peer.types';

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
 */
@Injectable()
export class AskAgentTool
  implements IDynamicallyDescribedTool, IConditionallyListedTool
{
  private readonly logger = new Logger(AskAgentTool.name);

  constructor(
    private readonly peers: IPeerGateway,
    private readonly delegations: DelegationService,
    private readonly a2aServer: A2aServerService,
  ) {}

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
   * An agent with no peers must not see this tool at all. A description saying
   * "you have none" would still be an advertisement for colleagues that do not
   * exist, and models act on tool lists, not on caveats inside them.
   */
  async isListedForRequest(httpRequest: Request): Promise<boolean> {
    const agentId = extractAgentId(httpRequest);
    if (!agentId) return false;
    const connections = await this.peers.listByAgent(agentId);
    // This IS the moment the running pod learns its peer set — record it,
    // even when the set is empty, so the console can say "armed" honestly
    // (CLEAN-95). Best-effort: an indicator must never break a tools/list.
    await this.recordServed(agentId, connections);
    return connections.length > 0;
  }

  async describeForRequest(httpRequest: Request): Promise<string | null> {
    const agentId = extractAgentId(httpRequest);
    if (!agentId) return null;

    const connections = await this.peers.listByAgent(agentId);
    await this.recordServed(agentId, connections);
    if (connections.length === 0) return null;

    return [
      BASE_DESCRIPTION,
      '',
      'Your peers:',
      ...connections.map((c) => describePeer(c)),
    ].join('\n');
  }

  @Tool({
    name: 'ask_agent',
    topic: ToolTopics.Peers,
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
        peer: parsed.data.peer,
        task: parsed.data.task,
        reason: parsed.data.reason,
        contextId: parsed.data.context_id,
        // This agent may itself be serving a delegation right now. Carrying
        // that chain forward is what lets the far end refuse a loop it can see
        // and this end cannot.
        inboundChain: this.a2aServer.currentChain(agentId),
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

    if (outcome.status === DelegationStatuses.Answered) {
      if (!outcome.text) {
        // Said explicitly: an empty tool result reads to a model like "no
        // news", and it will fill the gap itself (CLEAN-97).
        return ok(
          `«${outcome.peerName}» answered (context_id: ${outcome.contextId}, ${took}), but the reply was empty — no text, data or links. Tell the user it returned nothing; do not invent what it might have said.`,
        );
      }
      return ok(
        `Reply from «${outcome.peerName}» (context_id: ${outcome.contextId}, ${took}):\n\n${outcome.text}`,
      );
    }

    if (outcome.status === DelegationStatuses.Rejected) {
      return err(
        `«${outcome.peerName}» refused the task: ${outcome.cause ?? causeText(outcome.errorCode ?? null)}. ${DO_NOT_GUESS}`,
      );
    }

    return err(
      `Could not reach «${outcome.peerName}»: ${causeText(outcome.errorCode ?? null)}. ${DO_NOT_GUESS}`,
    );
  }
}

/**
 * One line per peer, carrying exactly what a choice needs: what it is, how to
 * name it, and what its card claims it can do.
 */
function describePeer(connection: IAgentPeerData): string {
  const card = connection.cardSnapshot;
  const name = card?.name ?? connection.peerAgentId ?? connection.id;
  const description = card?.description ?? '';
  const skills = (card?.skills ?? [])
    .map((s) => `${s.name} (${s.description})`)
    .join('; ');

  // External peers have no agent id here; the connection id names them just
  // as reliably — matchPeer resolves both (CLEAN-95).
  const parts = [
    `- "${name}" (peer: ${connection.peerAgentId ?? connection.id})`,
  ];
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
