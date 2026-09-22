import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { LogTool } from './log.tool';
import type { LogService } from './domain';
import type { IAgentGateway } from '#/agent/agent/domain';
import { UserRoleTypes } from '#/user/user/domain';

// The k8s client ships as ESM, which this jest cannot load; the tool never
// touches it directly (LogService does), so an empty stand-in is enough.
jest.mock('@kubernetes/client-node', () => ({
  CoreV1Api: class {},
  KubeConfig: class {},
}));

/**
 * Pod output is the one place an agent's secrets can leak in plain text, so
 * the gate matters as much as the read: a plain agent must neither see nor
 * call this tool. The read itself is `LogService`'s; here we check the tool
 * asks it for the right pod and tail and turns its markers into sentences a
 * model can act on.
 */
const request = (roles: UserRoleTypes[]): Request =>
  ({
    user: { sub: 'agent:agent-ops', email: '', roles },
  }) as unknown as Request;

const operator = () => request([UserRoleTypes.Owner]);
const plainAgent = () => request([UserRoleTypes.Agent]);

const THREE_LINES =
  '2026-09-22T10:00:00Z booting\n' +
  '2026-09-22T10:00:01Z listening on :8080\n' +
  '2026-09-22T10:00:02Z ready\n';

interface Harness {
  tool: LogTool;
  agents: { findById: jest.Mock };
  logs: { parseTail: jest.Mock; readPodLogs: jest.Mock };
}

function harness(): Harness {
  const agents = {
    findById: jest.fn().mockResolvedValue({
      id: 'agent-a',
      name: 'Support Bot',
      status: 'running',
    }),
  };
  const logs = {
    // The real parser clamps to [1, 5000]; the tool only needs its shape.
    parseTail: jest.fn((raw?: number) => raw ?? 500),
    readPodLogs: jest
      .fn()
      .mockResolvedValue({ state: 'logs', logs: THREE_LINES }),
  };
  const tool = new LogTool(
    agents as unknown as IAgentGateway,
    logs as unknown as LogService,
  );
  return { tool, agents, logs };
}

const textOf = (result: { content: { text: string }[] }) =>
  result.content[0].text;

describe('LogTool — who may use it', () => {
  it('hides the tool from an agent that is not a Ranch operator', async () => {
    const { tool } = harness();
    await expect(tool.isListedForRequest(plainAgent())).resolves.toBe(false);
  });

  it('lists it for an operator agent', async () => {
    const { tool } = harness();
    await expect(tool.isListedForRequest(operator())).resolves.toBe(true);
  });

  it('refuses a call from a plain agent even by name', async () => {
    const { tool, logs, agents } = harness();
    await expect(
      tool.getAgentLogs({ agentId: 'agent-a' }, null, plainAgent()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(agents.findById).not.toHaveBeenCalled();
    expect(logs.readPodLogs).not.toHaveBeenCalled();
  });
});

describe('LogTool — reading', () => {
  it('reads the requested tail of the agent pod', async () => {
    const { tool, logs } = harness();
    const result = await tool.getAgentLogs(
      { agentId: 'agent-a', lines: 3 },
      null,
      operator(),
    );
    expect(logs.readPodLogs).toHaveBeenCalledWith('agent-a', 'running', 3);
    const parsed = JSON.parse(textOf(result)) as {
      agentId: string;
      lines: number;
      logs: string;
    };
    expect(parsed).toEqual({ agentId: 'agent-a', lines: 3, logs: THREE_LINES });
    expect(result.isError).toBeUndefined();
  });

  it('asks for 100 lines when not told how many', async () => {
    const { tool, logs } = harness();
    await tool.getAgentLogs({ agentId: 'agent-a' }, null, operator());
    expect(logs.parseTail).toHaveBeenCalledWith(100);
    expect(logs.readPodLogs).toHaveBeenCalledWith('agent-a', 'running', 100);
  });

  it('trims to the tail when the read returns more lines than asked', async () => {
    const { tool } = harness();
    const parsed = JSON.parse(
      textOf(
        await tool.getAgentLogs(
          { agentId: 'agent-a', lines: 2 },
          null,
          operator(),
        ),
      ),
    ) as { lines: number; logs: string };
    expect(parsed.lines).toBe(2);
    expect(parsed.logs).toBe(
      '2026-09-22T10:00:01Z listening on :8080\n2026-09-22T10:00:02Z ready\n',
    );
  });

  it('passes a "container starting" marker through as the log text', async () => {
    const { tool, logs } = harness();
    logs.readPodLogs.mockResolvedValue({
      state: 'waiting',
      logs: '[container containercreating]',
    });
    const text = textOf(
      await tool.getAgentLogs({ agentId: 'agent-a' }, null, operator()),
    );
    expect(text).toContain('[container containercreating]');
    expect(text).not.toContain('error');
  });
});

describe('LogTool — refusals name the next move', () => {
  it('points at list_agents for an unknown agent and does not read', async () => {
    const { tool, agents, logs } = harness();
    agents.findById.mockResolvedValue(null);
    const text = textOf(
      await tool.getAgentLogs({ agentId: 'agent-zzz' }, null, operator()),
    );
    expect(text).toContain('not found');
    expect(text).toContain('list_agents');
    expect(logs.readPodLogs).not.toHaveBeenCalled();
  });

  it('points at start_agent when the agent has no pod', async () => {
    const { tool, agents, logs } = harness();
    agents.findById.mockResolvedValue({
      id: 'agent-a',
      name: 'Support Bot',
      status: 'stopped',
    });
    logs.readPodLogs.mockResolvedValue({
      state: 'no_pod',
      logs: '[no pod yet for stopped agent]',
    });
    const text = textOf(
      await tool.getAgentLogs({ agentId: 'agent-a' }, null, operator()),
    );
    expect(logs.readPodLogs).toHaveBeenCalledWith('agent-a', 'stopped', 100);
    expect(text).toContain('Agent «Support Bot» has no running pod');
    expect(text).toContain('start_agent');
  });
});
