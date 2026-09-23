import { ForbiddenException } from '@nestjs/common';
import type { ModuleRef } from '@nestjs/core';
import type { Request } from 'express';
import { LlmTool } from './llm.tool';
import { IAgentGateway } from '#/agent/agent/domain';
import { IUsageGateway } from '#/usage/domain';
import type { IUsageData } from '#/usage/domain';
import type { ILlmCredentialData } from './domain';
import type { ILlmGateway, ILlmHealthGateway } from './domain';
import { UserRoleTypes } from '#/user/user/domain';

/**
 * Two things matter more here than the happy paths: that the key handed to
 * create_llm/update_llm never comes back out of ANY tool (FR-004), and that a
 * plain agent can neither see nor call these.
 */
const SENTINEL = 'SENTINEL-LLM-KEY';

const credential = (
  overrides: Partial<ILlmCredentialData> = {},
): ILlmCredentialData => ({
  id: 'llm-1',
  provider: 'claude',
  model: 'claude-sonnet-4-6',
  fallbackModel: null,
  label: 'Main Claude',
  apiKey: SENTINEL,
  status: 'active',
  supportsChat: true,
  supportsEmbedding: false,
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  updatedAt: new Date('2026-09-01T00:00:00.000Z'),
  ...overrides,
});

const usageRow = (overrides: Partial<IUsageData> = {}): IUsageData => ({
  id: 'u-1',
  agentId: 'agent-a',
  llmCredentialId: 'llm-1',
  model: 'claude-sonnet-4-6',
  date: new Date('2026-09-20T00:00:00.000Z'),
  inputTokens: 1_000_000,
  outputTokens: 0,
  callCount: 3,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const request = (roles: UserRoleTypes[]): Request =>
  ({
    user: { sub: 'agent:agent-ops', email: '', roles },
  }) as unknown as Request;

const operator = () => request([UserRoleTypes.Owner]);
const plainAgent = () => request([UserRoleTypes.Agent]);

interface Harness {
  tool: LlmTool;
  llms: {
    findById: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  health: { check: jest.Mock };
  usage: { findRecentForCredential: jest.Mock };
  agents: { findAll: jest.Mock; findById: jest.Mock };
}

function harness(): Harness {
  const llms = {
    findById: jest.fn().mockResolvedValue(credential()),
    create: jest.fn().mockResolvedValue(credential({ id: 'llm-new' })),
    update: jest.fn().mockResolvedValue(credential({ label: 'Renamed' })),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const health = {
    check: jest.fn().mockResolvedValue({
      ok: true,
      latencyMs: 480,
      provider: 'claude',
      model: 'claude-sonnet-4-6',
    }),
  };
  const usage = {
    findRecentForCredential: jest.fn().mockResolvedValue([usageRow()]),
  };
  const agents = {
    findAll: jest.fn().mockResolvedValue([]),
    findById: jest
      .fn()
      .mockResolvedValue({ id: 'agent-a', name: 'Support Bot' }),
  };
  // LlmTool resolves the cross-slice gateways through ModuleRef (see the
  // constructor comment); the fake hands back the token asked for.
  const moduleRef = {
    get: jest.fn((token: unknown) => {
      if (token === IUsageGateway) return usage;
      if (token === IAgentGateway) return agents;
      throw new Error(`unexpected token ${String(token)}`);
    }),
  } as unknown as ModuleRef;

  const tool = new LlmTool(
    llms as unknown as ILlmGateway,
    health as unknown as ILlmHealthGateway,
    moduleRef,
  );
  return { tool, llms, health, usage, agents };
}

const textOf = (result: { content: { text: string }[] }) =>
  result.content[0].text;

describe('LlmTool — who may use it', () => {
  it('hides the tools from an agent that is not a Ranch operator', async () => {
    const { tool } = harness();
    await expect(tool.isListedForRequest(plainAgent())).resolves.toBe(false);
  });

  it('lists them for an operator agent', async () => {
    const { tool } = harness();
    await expect(tool.isListedForRequest(operator())).resolves.toBe(true);
  });

  it('refuses a call from a plain agent even by name', async () => {
    const { tool, llms } = harness();
    await expect(
      tool.getLlm({ id: 'llm-1' }, null, plainAgent()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      tool.deleteLlm({ id: 'llm-1', confirm: true }, null, plainAgent()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(llms.findById).not.toHaveBeenCalled();
    expect(llms.delete).not.toHaveBeenCalled();
  });
});

describe('LlmTool — the key never comes back (FR-004)', () => {
  it('get_llm returns the row without the key', async () => {
    const { tool, llms } = harness();
    const text = textOf(await tool.getLlm({ id: 'llm-1' }, null, operator()));
    expect(llms.findById).toHaveBeenCalledWith('llm-1');
    expect(text).toContain('Main Claude');
    expect(text).toContain('claude-sonnet-4-6');
    expect(text).not.toContain(SENTINEL);
    expect(text).not.toContain('apiKey');
  });

  it('create_llm stores the key and does not echo it', async () => {
    const { tool, llms } = harness();
    const text = textOf(
      await tool.createLlm(
        {
          provider: 'claude',
          model: 'claude-sonnet-4-6',
          apiKey: SENTINEL,
          label: 'Main Claude',
        },
        null,
        operator(),
      ),
    );
    expect(llms.create).toHaveBeenCalledWith({
      provider: 'claude',
      model: 'claude-sonnet-4-6',
      apiKey: SENTINEL,
      label: 'Main Claude',
    });
    expect(text).toContain('llm-new');
    expect(text).toContain('health_check_llm');
    expect(text).not.toContain(SENTINEL);
    expect(text).not.toContain('apiKey');
  });

  it('create_llm normalises a pasted .env line, as the console does', async () => {
    const { tool, llms } = harness();
    await tool.createLlm(
      {
        provider: 'openai',
        model: 'gpt-4o',
        apiKey: `OPENAI_API_KEY="${SENTINEL}"`,
      },
      null,
      operator(),
    );
    expect(llms.create).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: SENTINEL }),
    );
  });

  it('update_llm replaces the key, acknowledges, and does not echo it', async () => {
    const { tool, llms } = harness();
    const text = textOf(
      await tool.updateLlm(
        { id: 'llm-1', apiKey: SENTINEL, label: 'Renamed' },
        null,
        operator(),
      ),
    );
    expect(llms.update).toHaveBeenCalledWith('llm-1', {
      apiKey: SENTINEL,
      label: 'Renamed',
    });
    expect(text).toContain('Renamed');
    expect(text).toContain('key was replaced');
    expect(text).not.toContain(SENTINEL);
    // `changed` may name the field; the row must not carry it.
    expect(text).not.toContain('"apiKey":');
  });

  it('health_check_llm scrubs the key from a provider error that echoed it', async () => {
    const { tool, health } = harness();
    health.check.mockResolvedValue({
      ok: false,
      latencyMs: 12,
      provider: 'claude',
      model: 'claude-sonnet-4-6',
      error: `Anthropic 401: key ${SENTINEL} is invalid`,
    });
    const text = textOf(
      await tool.healthCheckLlm({ id: 'llm-1' }, null, operator()),
    );
    expect(text).toContain('"ok": false');
    expect(text).toContain('[redacted]');
    expect(text).not.toContain(SENTINEL);
  });

  it('llm_usage names the credential without its key', async () => {
    const { tool } = harness();
    const text = textOf(await tool.llmUsage({ id: 'llm-1' }, null, operator()));
    expect(text).toContain('Main Claude');
    expect(text).not.toContain(SENTINEL);
    expect(text).not.toContain('apiKey');
  });
});

describe('LlmTool — reading', () => {
  it('says a missing credential is not found and where to look', async () => {
    const { tool, llms } = harness();
    llms.findById.mockResolvedValue(null);
    for (const call of [
      () => tool.getLlm({ id: 'nope' }, null, operator()),
      () => tool.healthCheckLlm({ id: 'nope' }, null, operator()),
      () => tool.llmUsage({ id: 'nope' }, null, operator()),
      () => tool.updateLlm({ id: 'nope', label: 'x' }, null, operator()),
      () => tool.deleteLlm({ id: 'nope', confirm: true }, null, operator()),
    ]) {
      const text = textOf(await call());
      expect(text).toContain('not found');
      expect(text).toContain('list_llms');
    }
    expect(llms.update).not.toHaveBeenCalled();
    expect(llms.delete).not.toHaveBeenCalled();
  });

  it('health-checks with the stored credential and passes the verdict through', async () => {
    const { tool, health } = harness();
    const text = textOf(
      await tool.healthCheckLlm({ id: 'llm-1' }, null, operator()),
    );
    expect(health.check).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'llm-1', apiKey: SENTINEL }),
    );
    expect(text).toContain('"ok": true');
    expect(text).toContain('"latencyMs": 480');
  });

  it('lists every known provider and its models', async () => {
    const { tool } = harness();
    const text = textOf(await tool.listLlmModels({}, null, operator()));
    expect(text).toContain('"id": "claude"');
    expect(text).toContain('"id": "openai"');
    expect(text).toContain('claude-sonnet-4-6');
    expect(text).toContain('text-embedding-3-small');
  });

  it('filters models by provider, accepting an alias', async () => {
    const { tool } = harness();
    const text = textOf(
      await tool.listLlmModels({ provider: 'Anthropic' }, null, operator()),
    );
    expect(text).toContain('claude-opus-4-7');
    expect(text).not.toContain('gpt-4o');
  });

  it('names the known providers when asked about an unknown one', async () => {
    const { tool } = harness();
    const text = textOf(
      await tool.listLlmModels({ provider: 'mistral' }, null, operator()),
    );
    expect(text).toContain('Unknown provider «mistral»');
    expect(text).toContain('claude');
    expect(text).toContain('openai');
  });

  it('rolls usage up per day and per agent with cost, as the usage route does', async () => {
    const { tool, usage, agents } = harness();
    usage.findRecentForCredential.mockResolvedValue([
      usageRow(),
      usageRow({ id: 'u-2', agentId: 'agent-b', outputTokens: 1_000_000 }),
      usageRow({
        id: 'u-3',
        agentId: 'agent-a',
        model: 'gpt-4o',
        date: new Date('2026-09-19T00:00:00.000Z'),
        inputTokens: 10,
        outputTokens: 0,
        callCount: 1,
      }),
    ]);
    agents.findById.mockImplementation(async (id: string) => {
      if (id === 'agent-a') return { id, name: 'Support Bot' };
      throw new Error('gone');
    });
    const result = JSON.parse(
      textOf(await tool.llmUsage({ id: 'llm-1' }, null, operator())),
    ) as {
      days: number;
      last30days: { date: string; model: string; costUsd: number }[];
      totals: {
        inputTokens: number;
        outputTokens: number;
        callCount: number;
        costUsd: number;
      };
      topModel: string;
      byAgent: { agentId: string; agentName: string; costUsd: number }[];
    };
    expect(usage.findRecentForCredential).toHaveBeenCalledWith('llm-1', 30);
    expect(result.days).toBe(30);
    // Two rows of the same day and model merge; newest day first.
    expect(result.last30days.map((e) => `${e.date}|${e.model}`)).toEqual([
      '2026-09-20|claude-sonnet-4-6',
      '2026-09-19|gpt-4o',
    ]);
    // Sonnet: 2M input at $3/M + 1M output at $15/M.
    expect(result.last30days[0].costUsd).toBeCloseTo(21, 6);
    expect(result.totals.callCount).toBe(7);
    expect(result.topModel).toBe('claude-sonnet-4-6');
    // Sorted by cost, and a deleted agent keeps its id as its name.
    expect(result.byAgent.map((a) => a.agentName)).toEqual([
      'agent-b',
      'Support Bot',
    ]);
    expect(result.byAgent[0].costUsd).toBeCloseTo(18, 6);
  });
});

describe('LlmTool — changing', () => {
  it('update_llm sends only the fields that were passed', async () => {
    const { tool, llms } = harness();
    const text = textOf(
      await tool.updateLlm(
        { id: 'llm-1', status: 'disabled', fallbackModel: null },
        null,
        operator(),
      ),
    );
    expect(llms.update).toHaveBeenCalledWith('llm-1', {
      status: 'disabled',
      fallbackModel: null,
    });
    expect(text).toContain('"changed"');
    expect(text).not.toContain('key was replaced');
  });

  it('update_llm refuses an empty change', async () => {
    const { tool, llms } = harness();
    const result = await tool.updateLlm({ id: 'llm-1' }, null, operator());
    expect(result.isError).toBe(true);
    expect(llms.update).not.toHaveBeenCalled();
  });

  it('delete_llm refuses without confirm and names the credential and its agents', async () => {
    const { tool, llms, agents } = harness();
    agents.findAll.mockResolvedValue([
      { id: 'agent-a', name: 'Support Bot', llmCredentialId: 'llm-1' },
      { id: 'agent-b', name: 'Other', llmCredentialId: 'llm-2' },
    ]);
    const result = await tool.deleteLlm({ id: 'llm-1' }, null, operator());
    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toContain('«Main Claude»');
    expect(text).toContain('«Support Bot»');
    expect(text).not.toContain('«Other»');
    expect(text).toContain('confirm: true');
    expect(llms.delete).not.toHaveBeenCalled();
  });

  it('delete_llm deletes once confirmed and says what to do with orphaned agents', async () => {
    const { tool, llms, agents } = harness();
    agents.findAll.mockResolvedValue([
      { id: 'agent-a', name: 'Support Bot', llmCredentialId: 'llm-1' },
    ]);
    const text = textOf(
      await tool.deleteLlm({ id: 'llm-1', confirm: true }, null, operator()),
    );
    expect(llms.delete).toHaveBeenCalledWith('llm-1');
    expect(text).toContain('deleted');
    expect(text).toContain('«Support Bot» (agent-a)');
    expect(text).toContain('update_agent');
    expect(text).not.toContain(SENTINEL);
  });

  it('delete_llm surfaces a database refusal instead of a stack', async () => {
    const { tool, llms } = harness();
    llms.delete.mockRejectedValue(
      Object.assign(new Error('Foreign key constraint failed'), {
        code: 'P2003',
      }),
    );
    const result = await tool.deleteLlm(
      { id: 'llm-1', confirm: true },
      null,
      operator(),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('still referenced');
  });

  it('lets an unexpected failure escape, so the MCP layer reports it', async () => {
    const { tool, llms } = harness();
    llms.findById.mockRejectedValue(new Error('database is down'));
    await expect(
      tool.getLlm({ id: 'llm-1' }, null, operator()),
    ).rejects.toThrow('database is down');
  });
});
