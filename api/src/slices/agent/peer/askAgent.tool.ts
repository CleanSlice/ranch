import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { Tool } from '#mcp';
import type { Request } from 'express';
import type { IAuthTokenPayload } from '#/user/auth/domain/auth.types';
import type { IDynamicallyDescribedTool } from '#/mcp/interfaces/dynamic-description.interface';
import type { IConditionallyListedTool } from '#/mcp/interfaces/conditional-listing.interface';
import { IPeerGateway } from './domain/peer.gateway';
import { DelegationService } from './domain/delegation.service';
import { A2aServerService } from './domain/a2a.server.service';
import { causeText } from './domain/delegationStep';
import { DelegationStatuses, type IAgentPeerData } from './domain/peer.types';

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
  'tools do not. Do NOT call it for anything you can do yourself — a peer is ' +
  'a colleague, not a first resort. The peer does not see this conversation, ' +
  'so send it a self-contained task in plain text. If several independent ' +
  'questions go to different peers, call this tool once for each in the same ' +
  'turn. Give a one-line `reason` naming the skill that made you pick that ' +
  'peer: it is shown to the person watching.';

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

  /**
   * An agent with no peers must not see this tool at all. A description saying
   * "you have none" would still be an advertisement for colleagues that do not
   * exist, and models act on tool lists, not on caveats inside them.
   */
  async isListedForRequest(httpRequest: Request): Promise<boolean> {
    const agentId = extractAgentId(httpRequest);
    if (!agentId) return false;
    const connections = await this.peers.listByAgent(agentId);
    return connections.length > 0;
  }

  async describeForRequest(httpRequest: Request): Promise<string | null> {
    const agentId = extractAgentId(httpRequest);
    if (!agentId) return null;

    const connections = await this.peers.listByAgent(agentId);
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
      return ok(
        `Reply from «${outcome.peerName}» (context_id: ${outcome.contextId}, ${took}):\n\n${outcome.text ?? ''}`,
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
  const name = card?.name ?? connection.peerAgentId;
  const description = card?.description ?? '';
  const skills = (card?.skills ?? [])
    .map((s) => `${s.name} (${s.description})`)
    .join('; ');

  const parts = [`- "${name}" (peer: ${connection.peerAgentId})`];
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
