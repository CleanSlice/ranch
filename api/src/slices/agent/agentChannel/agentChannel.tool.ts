import { Injectable, Logger } from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { Tool, ToolTopics } from '#mcp';
import type { IConditionallyListedTool } from '#/mcp/interfaces/conditional-listing.interface';
import {
  callerIsOperator,
  ok,
  requireOperator,
  stripSecrets,
  type ToolResult,
} from '#/mcp/tooling';
import { IAgentGateway } from '#/agent/agent/domain';
import { IAuthTokenPayload } from '#/user/auth/domain';
import { IAgentChannelGateway } from './domain/agentChannel.gateway';
import type { IAgentChannel } from './domain/agentChannel.types';

type AuthedRequest = Request & { user?: IAuthTokenPayload };

/** Same cap as `SetAgentChannelsDto` (`@ArrayMaxSize(8)`). */
const MAX_CHANNELS = 8;

/**
 * A bot token is the channel's credential. `stripSecrets` knows Ranch's usual
 * credential field names but not this one, so the list is spelled out here.
 */
const CHANNEL_SECRET_KEYS = [
  'botToken',
  'apiKey',
  'authValue',
  'password',
  'passwordHash',
  'secret',
  'token',
] as const;

const telegramChannel = z.object({
  type: z
    .literal('telegram')
    .describe('Channel type. v1 supports telegram only.'),
  config: z.object({
    botToken: z
      .string()
      .min(1)
      .describe('Telegram bot HTTP API token, issued by @BotFather'),
    botName: z
      .string()
      .optional()
      .describe('Public bot username without @ — shown on landing pages'),
    adminIds: z
      .string()
      .optional()
      .describe(
        'Comma-separated Telegram chat ids the runtime treats as bot admins',
      ),
  }),
});

type ChannelInput = z.infer<typeof telegramChannel>;

/**
 * The agent's delivery channels, from the chat (CLEAN-109). Mirrors
 * `AgentChannelController`: the same `IAgentChannelGateway`, the same
 * exhaustive-list semantics on write. Operator-only — a plain agent edits
 * its own channels through the runtime's `channel_*` tools, not this one.
 *
 * The controller trusts its caller to send an id that exists, because the
 * console only ever sends ids it listed. A model may not, and the gateway
 * treats a missing file as "no channels" — so a typo would read as an empty
 * set, and a write would create files under an agent that is not there. The
 * tool therefore resolves the agent first and names it in the answer.
 */
@Injectable()
export class AgentChannelTool implements IConditionallyListedTool {
  private readonly logger = new Logger(AgentChannelTool.name);

  constructor(
    private readonly channels: IAgentChannelGateway,
    private readonly agents: IAgentGateway,
  ) {}

  async isListedForRequest(httpRequest: Request): Promise<boolean> {
    return Promise.resolve(callerIsOperator(httpRequest));
  }

  @Tool({
    name: 'get_agent_channels',
    topic: ToolTopics.AgentWorkspace,
    title: 'Show delivery channels',
    template: 'Which channels is the agent «name» connected to?',
    description:
      'The delivery channels an agent is configured for (Telegram in v1) ' +
      'with the live state the runtime last reported: connected true = ' +
      'polling, false = the last start failed (see statusReason), null = ' +
      'nothing reported yet. Bot tokens are never returned. Returns an empty ' +
      'list when nothing is configured. Takes the agent id — resolve a name ' +
      'with list_agents first.',
    parameters: z.object({
      agentId: z
        .string()
        .describe('Agent id, e.g. agent-abc123 (list_agents has them)'),
    }),
  })
  async getAgentChannels(
    { agentId }: { agentId: string },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const agent = await this.agents.findById(agentId);
    if (!agent) return notFound(agentId);
    const channels = await this.channels.getForAgent(agentId);
    return ok({
      agentId: agent.id,
      agentName: agent.name,
      channels: stripSecrets(channels, CHANNEL_SECRET_KEYS),
    });
  }

  @Tool({
    name: 'set_agent_channels',
    topic: ToolTopics.AgentWorkspace,
    title: 'Set delivery channels',
    template: 'Connect the agent «name» to «channel list»',
    description:
      "Replace the agent's delivery channels with exactly this list — a " +
      'channel left out is disconnected, and an empty list disconnects all. ' +
      'Read get_agent_channels first so nothing is dropped by accident. The ' +
      'bot token you pass is stored and never echoed back. A running agent ' +
      'picks the change up on its next restart (restart_agent). Takes the ' +
      'agent id — resolve a name with list_agents first.',
    parameters: z.object({
      agentId: z
        .string()
        .describe('Agent id, e.g. agent-abc123 (list_agents has them)'),
      channels: z
        .array(telegramChannel)
        .max(MAX_CHANNELS)
        .describe(
          'The full set of channels. Pass [] to disconnect every channel.',
        ),
    }),
  })
  async setAgentChannels(
    { agentId, channels }: { agentId: string; channels: ChannelInput[] },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const agent = await this.agents.findById(agentId);
    if (!agent) return notFound(agentId);
    const saved = await this.channels.setForAgent(
      agentId,
      channels as IAgentChannel[],
    );
    this.logger.log(
      `Channels set through MCP: agent=${agentId} types=${
        channels.map((c) => c.type).join(',') || 'none'
      }`,
    );
    return ok({
      message:
        channels.length === 0
          ? `Every channel of «${agent.name}» is now disconnected.`
          : `Channels of «${agent.name}» replaced.`,
      channels: stripSecrets(saved, CHANNEL_SECRET_KEYS),
      note:
        'A running agent keeps its old channel settings until it restarts — ' +
        `restart_agent with id=${agentId} when the person is ready.`,
    });
  }
}

function notFound(agentId: string): ToolResult {
  return ok({
    error: `Agent ${agentId} not found — call list_agents to find the id`,
  });
}
