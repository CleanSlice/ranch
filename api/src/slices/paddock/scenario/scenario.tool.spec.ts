import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { asPerson, asTrustedAgent } from '#/mcp/testing';
import { toolAudienceOf } from '#/mcp/decorators';
import { UserRoleTypes } from '#/user/user/domain';
import { openAccess } from '#/user/agentAccess/domain/__fixtures__/agentAccess';
import { PaddockScenarioTool } from './scenario.tool';

const draft = (name: string) => ({
  templateId: null,
  agentId: 'agent-1',
  category: 'conversation',
  difficulty: 'medium',
  name,
  description: `${name} desc`,
  expectedBehavior: 'Refunds within policy',
  messages: [{ text: 'I want a refund', from: 'user' }],
  successCriteria: [
    { dimension: 'correctness', description: 'Quotes policy', weight: 1 },
  ],
  setup: null,
});

const harness = () => {
  const scenarios = {
    findAll: jest.fn(async () => []),
    findById: jest.fn(async (id: string) =>
      id === 'sc-1' ? { id: 'sc-1', name: 'Refund flow' } : null,
    ),
    delete: jest.fn(async () => undefined),
    create: jest.fn(),
    update: jest.fn(),
  };
  let n = 0;
  const generator = {
    generate: jest.fn(async () => draft(`Draft ${++n}`)),
  };
  const tool = new PaddockScenarioTool(
    scenarios as never,
    generator as never,
    openAccess(),
  );
  return { tool, scenarios, generator };
};

const textOf = (r: { content: { text: string }[] }) => r.content[0].text;

const request = (roles: UserRoleTypes[]): Request =>
  ({
    user: { sub: 'agent:agent-ops', email: '', roles },
  }) as unknown as Request;

const operator = () => asTrustedAgent(request([UserRoleTypes.Owner]));
const plainAgent = () => asTrustedAgent(request([UserRoleTypes.Agent]));

describe('PaddockScenarioTool — delete_paddock_scenario (CLEAN-109)', () => {
  it('deletes once confirmed', async () => {
    const { tool, scenarios } = harness();
    const result = await tool.remove(
      { id: 'sc-1', confirm: true },
      null,
      operator(),
    );
    expect(scenarios.delete).toHaveBeenCalledWith('sc-1');
    expect(textOf(result)).toContain('"ok": true');
  });

  it('refuses without confirm, naming the scenario, and deletes nothing', async () => {
    const { tool, scenarios } = harness();
    const result = await tool.remove({ id: 'sc-1' }, null, operator());
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('«Refund flow»');
    expect(textOf(result)).toContain('confirm: true');
    expect(scenarios.delete).not.toHaveBeenCalled();
  });

  it('reports a missing scenario before asking for confirmation', async () => {
    const { tool, scenarios } = harness();
    const result = await tool.remove({ id: 'nope' }, null, operator());
    expect(textOf(result)).toContain('not found');
    expect(scenarios.delete).not.toHaveBeenCalled();
  });
});

describe('PaddockScenarioTool — generate_paddock_scenarios (CLEAN-109)', () => {
  it('drafts one scenario by default, passing the scope through as the controller does', async () => {
    const { tool, generator, scenarios } = harness();
    const result = await tool.generate(
      {
        description: 'refund requests',
        agentId: 'agent-1',
        category: 'conversation',
      },
      null,
      operator(),
    );
    expect(generator.generate).toHaveBeenCalledTimes(1);
    expect(generator.generate).toHaveBeenCalledWith({
      description: 'refund requests',
      templateId: undefined,
      agentId: 'agent-1',
      category: 'conversation',
      difficulty: undefined,
      credentialId: undefined,
    });
    const text = textOf(result);
    expect(text).toContain('"name": "Draft 1"');
    expect(text).toContain('Not saved');
    // Drafts are for review; the tool never persists them.
    expect(scenarios.create).not.toHaveBeenCalled();
  });

  it('drafts «count» scenarios one after another', async () => {
    const { tool, generator } = harness();
    const result = await tool.generate(
      {
        description: 'refund requests',
        templateId: 'tpl-1',
        count: 3,
        credentialId: 'cred-1',
      },
      null,
      operator(),
    );
    expect(generator.generate).toHaveBeenCalledTimes(3);
    expect(generator.generate).toHaveBeenLastCalledWith(
      expect.objectContaining({ templateId: 'tpl-1', credentialId: 'cred-1' }),
    );
    const text = textOf(result);
    expect(text).toContain('"name": "Draft 1"');
    expect(text).toContain('"name": "Draft 3"');
  });

  it('refuses an ambiguous scope without calling the LLM', async () => {
    const { tool, generator } = harness();
    const both = await tool.generate(
      {
        description: 'x',
        agentId: 'agent-1',
        templateId: 'tpl-1',
      },
      null,
      operator(),
    );
    const neither = await tool.generate({ description: 'x' }, null, operator());
    expect(textOf(both)).toContain('exactly one of');
    expect(textOf(neither)).toContain('exactly one of');
    expect(generator.generate).not.toHaveBeenCalled();
  });
});

/**
 * CLEAN-232. Until then these tools had no gate at all: no listing hook, no
 * check in the body. Any agent runtime could call them by name, and so could
 * whoever was chatting with one.
 */
describe('PaddockScenarioTool — who may use it (CLEAN-232)', () => {
  const answering = (role: UserRoleTypes) => () =>
    asPerson(request([UserRoleTypes.Owner]), role);
  const everyCall = (tool: PaddockScenarioTool, req: () => Request) => [
    () => tool.list({}, null, req()),
    () => tool.get({ id: 'sc-1' }, null, req()),
    () => tool.listForAgent({ agentId: 'agent-1' }, null, req()),
    () => tool.create({ agentId: 'agent-1' } as never, null, req()),
    () => tool.update({ id: 'sc-1', name: 'x' } as never, null, req()),
    () => tool.remove({ id: 'sc-1', confirm: true }, null, req()),
    () => tool.generate({ description: 'x', agentId: 'agent-1' }, null, req()),
  ];

  it('is an admin tool, as the paddock routes are an operator’s', () => {
    expect(toolAudienceOf(PaddockScenarioTool, undefined)).toBe('admin');
  });

  it('is listed for the Ranch admin agent itself, an Owner and an Admin', async () => {
    const { tool } = harness();
    expect(await tool.isListedForRequest(operator())).toBe(true);
    expect(
      await tool.isListedForRequest(answering(UserRoleTypes.Owner)()),
    ).toBe(true);
    expect(
      await tool.isListedForRequest(answering(UserRoleTypes.Admin)()),
    ).toBe(true);
  });

  it('is hidden from a plain agent, a User and a call that names nobody', async () => {
    const { tool } = harness();
    expect(await tool.isListedForRequest(plainAgent())).toBe(false);
    expect(await tool.isListedForRequest(answering(UserRoleTypes.User)())).toBe(
      false,
    );
    expect(await tool.isListedForRequest(request([UserRoleTypes.Owner]))).toBe(
      false,
    );
  });

  it('refuses every tool by name for those three, and touches nothing', async () => {
    const h = harness();
    const callers = [
      plainAgent,
      answering(UserRoleTypes.User),
      () => request([UserRoleTypes.Owner]),
    ];

    for (const caller of callers) {
      for (const call of everyCall(h.tool, caller)) {
        await expect(call()).rejects.toBeInstanceOf(ForbiddenException);
      }
    }
    for (const group of Object.values(h)) {
      if (group === h.tool) continue;
      for (const fn of Object.values(group as Record<string, jest.Mock>)) {
        expect(fn).not.toHaveBeenCalled();
      }
    }
  });
});
