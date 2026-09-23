import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { AgentChannelTool } from './agentChannel.tool';
import type { IAgentChannelGateway } from './domain/agentChannel.gateway';
import type { IAgentChannel } from './domain/agentChannel.types';
import type { IAgentGateway } from '#/agent/agent/domain';
import { UserRoleTypes } from '#/user/user/domain';

/**
 * Two things matter more than the happy path here: that a bot token never
 * reaches the model's context, in either direction (a token read back from
 * the workspace is a token in a transcript), and that a mistyped agent id is
 * reported instead of being read as "no channels" or written as a new agent.
 */
const BOT_TOKEN = '123456:SECRET-bot-token';

const channel = (overrides: Partial<IAgentChannel> = {}): IAgentChannel => ({
  type: 'telegram',
  config: { botToken: BOT_TOKEN, botName: 'support_bot', adminIds: '42' },
  connected: true,
  statusReason: null,
  statusUpdatedAt: 1758000000000,
  ...overrides,
});

const request = (roles: UserRoleTypes[]): Request =>
  ({
    user: { sub: 'agent:agent-ops', email: '', roles },
  }) as unknown as Request;

const operator = () => request([UserRoleTypes.Owner]);
const plainAgent = () => request([UserRoleTypes.Agent]);

interface Harness {
  tool: AgentChannelTool;
  channels: { getForAgent: jest.Mock; setForAgent: jest.Mock };
  agents: { findById: jest.Mock };
}

function harness(): Harness {
  const channels = {
    getForAgent: jest.fn().mockResolvedValue([channel()]),
    setForAgent: jest.fn().mockResolvedValue([channel()]),
  };
  const agents = {
    findById: jest
      .fn()
      .mockResolvedValue({ id: 'agent-a', name: 'Support Bot' }),
  };
  const tool = new AgentChannelTool(
    channels as unknown as IAgentChannelGateway,
    agents as unknown as IAgentGateway,
  );
  return { tool, channels, agents };
}

const textOf = (result: { content: { text: string }[] }) =>
  result.content[0].text;

const input = () => [
  {
    type: 'telegram' as const,
    config: { botToken: BOT_TOKEN, botName: 'support_bot' },
  },
];

describe('AgentChannelTool — who may use it', () => {
  it('hides the tools from an agent that is not a Ranch operator', async () => {
    const { tool } = harness();
    await expect(tool.isListedForRequest(plainAgent())).resolves.toBe(false);
  });

  it('lists them for an operator agent', async () => {
    const { tool } = harness();
    await expect(tool.isListedForRequest(operator())).resolves.toBe(true);
  });

  it('refuses a call from a plain agent even by name', async () => {
    const { tool, channels } = harness();
    await expect(
      tool.setAgentChannels(
        { agentId: 'agent-a', channels: input() },
        null,
        plainAgent(),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(channels.setForAgent).not.toHaveBeenCalled();
  });

  it('refuses a read from a plain agent too', async () => {
    const { tool, channels } = harness();
    await expect(
      tool.getAgentChannels({ agentId: 'agent-a' }, null, plainAgent()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(channels.getForAgent).not.toHaveBeenCalled();
  });
});

describe('AgentChannelTool — reading', () => {
  it('reports the channels with their live state and without the bot token', async () => {
    const { tool, channels } = harness();
    const text = textOf(
      await tool.getAgentChannels({ agentId: 'agent-a' }, null, operator()),
    );
    expect(channels.getForAgent).toHaveBeenCalledWith('agent-a');
    expect(text).toContain('"telegram"');
    expect(text).toContain('support_bot');
    expect(text).toContain('"connected": true');
    expect(text).toContain('Support Bot');
    expect(text).not.toContain(BOT_TOKEN);
    expect(text).not.toContain('botToken');
  });

  it('answers an empty list for an agent with nothing configured', async () => {
    const { tool, channels } = harness();
    channels.getForAgent.mockResolvedValue([]);
    const text = textOf(
      await tool.getAgentChannels({ agentId: 'agent-a' }, null, operator()),
    );
    expect(text).toContain('"channels": []');
  });

  it('names the next move when the agent does not exist', async () => {
    const { tool, channels, agents } = harness();
    agents.findById.mockResolvedValue(null);
    const text = textOf(
      await tool.getAgentChannels({ agentId: 'agent-x' }, null, operator()),
    );
    expect(text).toContain('Agent agent-x not found');
    expect(text).toContain('list_agents');
    expect(channels.getForAgent).not.toHaveBeenCalled();
  });
});

describe('AgentChannelTool — replacing the set', () => {
  it('hands the full list to the gateway and acknowledges without the token', async () => {
    const { tool, channels } = harness();
    const text = textOf(
      await tool.setAgentChannels(
        { agentId: 'agent-a', channels: input() },
        null,
        operator(),
      ),
    );
    expect(channels.setForAgent).toHaveBeenCalledWith('agent-a', input());
    expect(text).toContain('Channels of «Support Bot» replaced');
    expect(text).toContain('restart_agent with id=agent-a');
    expect(text).not.toContain(BOT_TOKEN);
    expect(text).not.toContain('botToken');
  });

  it('passes an empty list through so every channel is disconnected', async () => {
    const { tool, channels } = harness();
    channels.setForAgent.mockResolvedValue([]);
    const text = textOf(
      await tool.setAgentChannels(
        { agentId: 'agent-a', channels: [] },
        null,
        operator(),
      ),
    );
    expect(channels.setForAgent).toHaveBeenCalledWith('agent-a', []);
    expect(text).toContain(
      'Every channel of «Support Bot» is now disconnected',
    );
  });

  it('writes nothing for an agent that does not exist', async () => {
    const { tool, channels, agents } = harness();
    agents.findById.mockResolvedValue(null);
    const text = textOf(
      await tool.setAgentChannels(
        { agentId: 'agent-x', channels: input() },
        null,
        operator(),
      ),
    );
    expect(text).toContain('not found');
    expect(channels.setForAgent).not.toHaveBeenCalled();
  });

  it('lets a storage failure escape, so the MCP layer reports it as an error', async () => {
    const { tool, channels } = harness();
    channels.setForAgent.mockRejectedValue(new Error('s3 is down'));
    await expect(
      tool.setAgentChannels(
        { agentId: 'agent-a', channels: input() },
        null,
        operator(),
      ),
    ).rejects.toThrow('s3 is down');
  });
});
