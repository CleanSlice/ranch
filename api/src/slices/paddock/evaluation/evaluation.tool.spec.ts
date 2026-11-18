import { NotFoundException } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { asPerson, asTrustedAgent } from '#/mcp/testing';
import { toolAudienceOf } from '#/mcp/decorators';
import { UserRoleTypes } from '#/user/user/domain';
import { openAccess } from '#/user/agentAccess/domain/__fixtures__/agentAccess';
import { PaddockEvaluationTool } from './evaluation.tool';

const snapshot = {
  id: 'sc-1',
  name: 'Refund flow',
  messages: [{ text: 'I want a refund', from: 'user' }],
  expectedBehavior: 'Quotes the policy',
  successCriteria: [],
};

const evaluation = {
  id: 'ev-1',
  status: 'completed',
  scenariosSnapshot: [snapshot],
  results: [
    {
      id: 'res-1',
      evaluationId: 'ev-1',
      scenarioId: 'sc-1',
      verdict: 'pass',
      finalScore: 0.9,
      agreement: 1,
      dimensionScores: { correctness: 0.9 },
      judges: [],
      failureReasons: [],
    },
  ],
};

const notFound = () => {
  throw new NotFoundException('Evaluation not found');
};

const harness = () => {
  const service = {
    abort: jest.fn(async (id: string) => ({ id, status: 'aborted' })),
    rerun: jest.fn(async (id: string) => ({
      id: `${id}-2`,
      status: 'running',
    })),
    getLogs: jest.fn(async (id: string) =>
      id === 'ev-1' ? { lines: ['one', 'two', 'three'] } : notFound(),
    ),
    getScenario: jest.fn(async (id: string, scenarioId: string) => {
      if (id !== 'ev-1') return notFound();
      if (scenarioId !== 'sc-1') {
        throw new NotFoundException(
          `Scenario ${scenarioId} is not part of evaluation ${id}`,
        );
      }
      return snapshot;
    }),
    getById: jest.fn(async (id: string) =>
      id === 'ev-1' ? evaluation : notFound(),
    ),
    getTrace: jest.fn(async (id: string, scenarioId: string) => {
      if (id !== 'ev-1') return notFound();
      return scenarioId === 'sc-1' ? { turns: [{ response: 'Sure' }] } : null;
    }),
  };
  const tool = new PaddockEvaluationTool(service as never, openAccess());
  return { tool, service };
};

const textOf = (r: { content: { text: string }[] }) => r.content[0].text;

const request = (roles: UserRoleTypes[]): Request =>
  ({
    user: { sub: 'agent:agent-ops', email: '', roles },
  }) as unknown as Request;

const operator = () => asTrustedAgent(request([UserRoleTypes.Owner]));
const plainAgent = () => asTrustedAgent(request([UserRoleTypes.Agent]));

describe('PaddockEvaluationTool — abort_paddock_evaluation (CLEAN-109)', () => {
  it('aborts once confirmed', async () => {
    const { tool, service } = harness();
    const result = await tool.abort(
      { id: 'ev-1', confirm: true },
      null,
      operator(),
    );
    expect(service.abort).toHaveBeenCalledWith('ev-1');
    expect(textOf(result)).toContain('"status": "aborted"');
  });

  it('refuses without confirm and aborts nothing', async () => {
    const { tool, service } = harness();
    const result = await tool.abort({ id: 'ev-1' }, null, operator());
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('abort the paddock evaluation ev-1');
    expect(service.abort).not.toHaveBeenCalled();
  });

  it('rerun needs no confirmation', async () => {
    const { tool, service } = harness();
    const result = await tool.rerun({ id: 'ev-1' }, null, operator());
    expect(service.rerun).toHaveBeenCalledWith('ev-1');
    expect(result.isError).toBeUndefined();
  });
});

describe('PaddockEvaluationTool — get_paddock_evaluation_logs (CLEAN-109)', () => {
  it('returns the buffered lines', async () => {
    const { tool, service } = harness();
    const result = await tool.logs({ id: 'ev-1' }, null, operator());
    expect(service.getLogs).toHaveBeenCalledWith('ev-1');
    const text = textOf(result);
    expect(text).toContain('"total": 3');
    expect(text).toContain('"one"');
    expect(text).toContain('"three"');
  });

  it('keeps only the last N lines when asked for a tail', async () => {
    const { tool } = harness();
    const text = textOf(
      await tool.logs({ id: 'ev-1', tail: 1 }, null, operator()),
    );
    expect(text).toContain('"total": 3');
    expect(text).toContain('"three"');
    expect(text).not.toContain('"one"');
  });

  it('turns a missing evaluation into a sentence naming the next move', async () => {
    const { tool } = harness();
    const text = textOf(await tool.logs({ id: 'nope' }, null, operator()));
    expect(text).toContain('Evaluation not found');
    expect(text).toContain('list_paddock_evaluations');
  });
});

describe('PaddockEvaluationTool — get_paddock_evaluation_scenario_result (CLEAN-109)', () => {
  it('returns the snapshot scenario with its verdict', async () => {
    const { tool, service } = harness();
    const result = await tool.scenarioResult(
      {
        id: 'ev-1',
        scenarioId: 'sc-1',
      },
      null,
      operator(),
    );
    expect(service.getScenario).toHaveBeenCalledWith('ev-1', 'sc-1');
    expect(service.getById).toHaveBeenCalledWith('ev-1');
    const text = textOf(result);
    expect(text).toContain('"name": "Refund flow"');
    expect(text).toContain('"verdict": "pass"');
    expect(text).toContain('"status": "completed"');
  });

  it('reports a scenario that is not part of the evaluation', async () => {
    const { tool } = harness();
    const text = textOf(
      await tool.scenarioResult(
        { id: 'ev-1', scenarioId: 'sc-9' },
        null,
        operator(),
      ),
    );
    expect(text).toContain('not part of evaluation ev-1');
  });

  it('reports a missing evaluation', async () => {
    const { tool } = harness();
    const text = textOf(
      await tool.scenarioResult(
        { id: 'nope', scenarioId: 'sc-1' },
        null,
        operator(),
      ),
    );
    expect(text).toContain('Evaluation not found');
    expect(text).toContain('list_paddock_evaluations');
  });
});

describe('PaddockEvaluationTool — get_paddock_evaluation_trace (CLEAN-109)', () => {
  it('returns the trace of a scenario', async () => {
    const { tool, service } = harness();
    const result = await tool.trace(
      { id: 'ev-1', scenarioId: 'sc-1' },
      null,
      operator(),
    );
    expect(service.getTrace).toHaveBeenCalledWith('ev-1', 'sc-1');
    expect(textOf(result)).toContain('"response": "Sure"');
  });

  it('explains a null trace instead of returning nothing', async () => {
    const { tool } = harness();
    const text = textOf(
      await tool.trace({ id: 'ev-1', scenarioId: 'sc-9' }, null, operator()),
    );
    expect(text).toContain('No trace for scenario sc-9');
    expect(text).toContain('get_paddock_evaluation');
  });

  it('reports a missing evaluation', async () => {
    const { tool } = harness();
    const text = textOf(
      await tool.trace({ id: 'nope', scenarioId: 'sc-1' }, null, operator()),
    );
    expect(text).toContain('Evaluation not found');
  });
});

/**
 * CLEAN-232. Until then these tools had no gate at all: no listing hook, no
 * check in the body. Any agent runtime could call them by name, and so could
 * whoever was chatting with one.
 */
describe('PaddockEvaluationTool — who may use it (CLEAN-232)', () => {
  const answering = (role: UserRoleTypes) => () =>
    asPerson(request([UserRoleTypes.Owner]), role);
  const everyCall = (tool: PaddockEvaluationTool, req: () => Request) => [
    () => tool.run({ agentId: 'agent-1' }, null, req()),
    () => tool.list({}, null, req()),
    () => tool.get({ id: 'ev-1' }, null, req()),
    () => tool.report({ id: 'ev-1' }, null, req()),
    () => tool.abort({ id: 'ev-1', confirm: true }, null, req()),
    () => tool.rerun({ id: 'ev-1' }, null, req()),
    () => tool.logs({ id: 'ev-1' }, null, req()),
    () => tool.scenarioResult({ id: 'ev-1', scenarioId: 'sc-1' }, null, req()),
    () => tool.trace({ id: 'ev-1', scenarioId: 'sc-1' }, null, req()),
  ];

  it('is an admin tool, as the paddock routes are an operator’s', () => {
    expect(toolAudienceOf(PaddockEvaluationTool, undefined)).toBe('admin');
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
