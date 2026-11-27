/**
 * The routes agree with the tools about the records of the Ranch assistant
 * (CLEAN-268): its usage, its request limits and load, its evaluations and
 * its scenarios are the Owner's. A person who has the assistant and is not
 * the Owner gets, on the route, the console's usual refusal: the 404 of an
 * agent that does not exist where the route names it, and a list without
 * its rows where the route lists across agents (as `GET /chats` does for
 * its conversations). No new status code, and no sentence: the tools say
 * why, the consoles do not offer these pages for an agent the viewer may
 * not manage.
 *
 * The access lists and the guard are the real ones; the controllers are the
 * real classes over data held in memory.
 */
import 'reflect-metadata';
import type { ExecutionContext } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AgentLimitController } from '#/agent/limit/agentLimit.controller';
import { PaddockEvaluationController } from '#/paddock/evaluation/evaluation.controller';
import { PaddockScenarioController } from '#/paddock/scenario/scenario.controller';
import { UsageController } from '#/usage/usage.controller';
import { UserRoleTypes } from '#/user/user/domain';
import {
  ADMIN,
  ADMIN2,
  OWNER,
  accessHarness,
} from '../domain/__fixtures__/agentAccess';
import { AgentAccessGuard } from './agentAccess.guard';
import {
  AGENT_SCOPED_METADATA_KEY,
  type IAgentScope,
} from './agentScoped.decorator';

jest.mock('@kubernetes/client-node', () => ({
  KubeConfig: class {
    loadFromDefault() {}
    loadFromCluster() {}
    makeApiClient() {
      return {};
    }
  },
  CoreV1Api: class {},
  CustomObjectsApi: class {},
  Log: class {},
  Watch: class {},
}));

// Two agents and the assistant. ADMIN is limited to `A`; ADMIN2's lists
// narrow nothing. Both have the assistant unless a test switches it off.
const A = 'agent-aaa';
const B = 'agent-bbb';
const RANCH = 'agent-ranch';
const GHOST = 'agent-zzz';
const IDS = [A, B, RANCH];

const { service: access, gateway: lists } = accessHarness(IDS);
lists.seed(ADMIN.id, true, [{ agentId: A, list: 'allowed' }]);

let assistantOffFor: string | null = null;
access.attachAssistant({
  assistantId: () => Promise.resolve(RANCH),
  forPerson: (person) =>
    Promise.resolve({ id: RANCH, enabled: person.userId !== assistantOffFor }),
});
afterEach(() => {
  assistantOffFor = null;
});

const bearer = (who: { id: string; role: UserRoleTypes }) => ({
  sub: who.id,
  email: '',
  roles: [who.role],
});
const req = (who: { id: string; role: UserRoleTypes }) =>
  ({ user: bearer(who) }) as unknown as Request;

// ── Where a route names the agent: the guard ─────────────────

const guard = new AgentAccessGuard(new Reflector(), access);

interface IRequestParts {
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: unknown;
}

async function answer(
  controller: { prototype: object },
  handler: string,
  who: { id: string; role: UserRoleTypes },
  parts: IRequestParts,
): Promise<true | { status: number; message: string }> {
  const context = {
    getHandler: () =>
      (controller.prototype as Record<string, unknown>)[handler],
    getClass: () => controller,
    switchToHttp: () => ({
      getRequest: () => ({ user: bearer(who), ...parts }),
    }),
  } as unknown as ExecutionContext;
  try {
    return (await guard.canActivate(context)) as true;
  } catch (e) {
    if (e instanceof NotFoundException) {
      return { status: e.getStatus(), message: e.message };
    }
    throw e;
  }
}

/** Every route that names an agent and returns records about it. */
const RECORD_ROUTES: Array<
  [string, { prototype: object }, string, (agentId: string) => IRequestParts]
> = [
  [
    'GET /agents/:agentId/usage',
    UsageController,
    'findForAgent',
    (agentId) => ({ params: { agentId } }),
  ],
  [
    'GET /agents/:agentId/limits',
    AgentLimitController,
    'get',
    (agentId) => ({ params: { agentId } }),
  ],
  [
    'GET /agents/:agentId/load',
    AgentLimitController,
    'load',
    (agentId) => ({ params: { agentId } }),
  ],
  [
    'POST /paddock-evaluations',
    PaddockEvaluationController,
    'start',
    (agentId) => ({ body: { agentId } }),
  ],
  [
    'GET /paddock-evaluations?agentId=',
    PaddockEvaluationController,
    'list',
    (agentId) => ({ query: { agentId } }),
  ],
  [
    'GET /paddock-scenarios?agentId=',
    PaddockScenarioController,
    'findAll',
    (agentId) => ({ query: { agentId } }),
  ],
  [
    'POST /paddock-scenarios',
    PaddockScenarioController,
    'create',
    (agentId) => ({ body: { agentId } }),
  ],
  [
    'POST /paddock-scenarios/generate',
    PaddockScenarioController,
    'generate',
    (agentId) => ({ body: { agentId } }),
  ],
];

describe.each(RECORD_ROUTES)('%s', (_route, controller, handler, naming) => {
  it('is marked as a route that returns records about the agent', () => {
    const scope = Reflect.getMetadata(
      AGENT_SCOPED_METADATA_KEY,
      (controller.prototype as Record<string, object>)[handler],
    ) as IAgentScope | undefined;
    expect(scope?.records).toBe(true);
  });

  it.each([
    ['limited to one agent', ADMIN],
    ['whose lists narrow nothing', ADMIN2],
  ])(
    'an Admin %s gets, for the assistant, the 404 of an agent that does not exist',
    async (_which, who) => {
      const mine = await answer(controller, handler, who, naming(RANCH));
      const unknown = await answer(controller, handler, ADMIN, naming(GHOST));

      expect(mine).toMatchObject({ status: 404 });
      // The same words as for an id that names nothing, its id aside.
      expect(JSON.stringify(mine).split(RANCH).join('<id>')).toBe(
        JSON.stringify(unknown).split(GHOST).join('<id>'),
      );
    },
  );

  it('an agent they reach passes, an agent out of reach is the same 404 as before', async () => {
    expect(await answer(controller, handler, ADMIN, naming(A))).toBe(true);
    expect(await answer(controller, handler, ADMIN, naming(B))).toMatchObject({
      status: 404,
    });
    expect(await answer(controller, handler, ADMIN2, naming(B))).toBe(true);
  });

  it('the Owner passes for the assistant', async () => {
    expect(await answer(controller, handler, OWNER, naming(RANCH))).toBe(true);
  });

  it('an Admin the assistant is switched off for: the same 404', async () => {
    assistantOffFor = ADMIN2.id;
    expect(
      await answer(controller, handler, ADMIN2, naming(RANCH)),
    ).toMatchObject({ status: 404 });
  });
});

describe('what a person needs in order to use the assistant stays', () => {
  it('whether it has request limits at all: `GET /agents/:agentId/limits/enabled` is not a records route', async () => {
    const scope = Reflect.getMetadata(
      AGENT_SCOPED_METADATA_KEY,
      (AgentLimitController.prototype as unknown as Record<string, object>)
        .enabled,
    ) as IAgentScope | undefined;

    expect(scope?.records).toBeUndefined();
    expect(
      await answer(AgentLimitController, 'enabled', ADMIN, {
        params: { agentId: RANCH },
      }),
    ).toBe(true);
  });
});

// ── Where a route names a record, or lists across agents ─────

const usageRow = (agentId: string) => ({
  id: `usage-of-${agentId}`,
  agentId,
  agentName: agentId,
  llmCredentialId: 'llm-1',
  model: 'm',
  date: new Date('2026-11-17T00:00:00Z'),
  inputTokens: 1000,
  outputTokens: 100,
  callCount: 5,
  createdAt: new Date(0),
  updatedAt: new Date(0),
});
const usage = new UsageController(
  {
    findRecentAll: () => Promise.resolve(IDS.map(usageRow)),
    findRecentForCredential: () => Promise.resolve(IDS.map(usageRow)),
  } as never,
  {} as never,
  { findById: (id: string) => Promise.resolve({ id, name: id }) } as never,
  {} as never,
  access,
);

const EVALUATIONS = IDS.map((agentId) => ({
  id: `eval-of-${agentId}`,
  agentId,
}));
const evaluationById = (id: string) => {
  const found = EVALUATIONS.find((e) => e.id === id);
  return found
    ? Promise.resolve(found)
    : Promise.reject(new NotFoundException('Evaluation not found'));
};
const evaluationService = {
  list: () => Promise.resolve(EVALUATIONS),
  getById: jest.fn(evaluationById),
  getReport: jest.fn(evaluationById),
  getLogs: jest.fn(evaluationById),
  getScenario: jest.fn(evaluationById),
  getTrace: jest.fn(evaluationById),
  abort: jest.fn(evaluationById),
  rerun: jest.fn(evaluationById),
};
const evaluations = new PaddockEvaluationController(
  evaluationService as never,
  access,
);

const SCENARIOS = [
  ...IDS.map((agentId) => ({ id: `scenario-of-${agentId}`, agentId })),
  { id: 'scenario-of-template', agentId: null },
];
const scenarioGateway = {
  findAll: () => Promise.resolve(SCENARIOS),
  findById: (id: string) =>
    Promise.resolve(SCENARIOS.find((s) => s.id === id) ?? null),
  update: jest.fn((id: string) => Promise.resolve({ id })),
  delete: jest.fn(() => Promise.resolve()),
};
const scenarios = new PaddockScenarioController(
  scenarioGateway as never,
  {} as never,
  access,
);

const limits = new AgentLimitController(
  {
    summary: (list: { id: string }[]) =>
      list.map((agent) => ({
        agentId: agent.id,
        enabled: true,
        atLimit: false,
        needsLimits: false,
      })),
  } as never,
  {
    findAll: () => Promise.resolve(IDS.map((id) => ({ id }))),
  } as never,
  access,
);

const agentIdsOf = (rows: readonly { agentId: string | null }[]) =>
  rows.map((row) => row.agentId);

async function refusal(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return 'answered';
  } catch (e) {
    if (e instanceof NotFoundException) return `404: ${e.message}`;
    throw e;
  }
}

beforeEach(() => jest.clearAllMocks());

describe('the totals', () => {
  it.each([
    ['GET /usage/overview', (r: Request) => usage.findOverview(r)],
    [
      'GET /llms/:id/usage',
      (r: Request) => usage.findForCredential('llm-1', r),
    ],
  ])(
    '%s: the assistant’s spend is in the totals for the Owner alone',
    async (_route, read) => {
      const whole = await read(req(OWNER));
      expect(agentIdsOf(whole.byAgent).sort()).toEqual([...IDS].sort());
      expect(whole.totals.callCount).toBe(15);

      const mine = await read(req(ADMIN2));
      expect(agentIdsOf(mine.byAgent).sort()).toEqual([A, B]);
      expect(mine.totals.callCount).toBe(10);

      const narrowed = await read(req(ADMIN));
      expect(agentIdsOf(narrowed.byAgent)).toEqual([A]);
      expect(narrowed.totals.callCount).toBe(5);
    },
  );
});

describe('GET /agent-limits', () => {
  it('has no line for the assistant, for anybody but the Owner', async () => {
    expect(agentIdsOf(await limits.list(req(OWNER) as never))).toEqual(IDS);
    expect(agentIdsOf(await limits.list(req(ADMIN2) as never))).toEqual([A, B]);
    expect(agentIdsOf(await limits.list(req(ADMIN) as never))).toEqual([A]);
  });
});

describe('the paddock routes', () => {
  it('the lists leave the assistant’s out, for anybody but the Owner', async () => {
    expect(
      agentIdsOf(
        (await evaluations.list(
          undefined,
          undefined,
          undefined,
          req(OWNER),
        )) as {
          agentId: string;
        }[],
      ),
    ).toEqual(IDS);
    expect(
      agentIdsOf(
        (await evaluations.list(
          undefined,
          undefined,
          undefined,
          req(ADMIN2),
        )) as { agentId: string }[],
      ),
    ).toEqual([A, B]);

    expect(
      agentIdsOf(await scenarios.findAll(undefined, undefined, req(OWNER))),
    ).toEqual([...IDS, null]);
    expect(
      agentIdsOf(await scenarios.findAll(undefined, undefined, req(ADMIN2))),
    ).toEqual([A, B, null]);
  });

  const BY_EVALUATION: Array<
    [string, (id: string, r: Request) => Promise<unknown>]
  > = [
    ['GET :id', (id, r) => evaluations.get(id, r)],
    ['GET :id/report', (id, r) => evaluations.report(id, r)],
    ['GET :id/logs', (id, r) => evaluations.logs(id, r)],
    [
      'GET :id/scenarios/:scenarioId',
      (id, r) => evaluations.scenario(id, 's', r),
    ],
    ['GET :id/trace', (id, r) => evaluations.trace(id, 's', r)],
    ['POST :id/abort', (id, r) => evaluations.abort(id, r)],
    ['POST :id/rerun', (id, r) => evaluations.rerun(id, r)],
  ];

  it.each(BY_EVALUATION)(
    'paddock-evaluations %s: an evaluation of the assistant is a 404 to an Admin, as one of an agent out of reach',
    async (_route, read) => {
      const ofAssistant = await refusal(() =>
        read(`eval-of-${RANCH}`, req(ADMIN2)),
      );
      const outOfReach = await refusal(() => read(`eval-of-${B}`, req(ADMIN)));

      expect(ofAssistant).toMatch(/^404: /);
      expect(ofAssistant).toBe(outOfReach);
      // Refused before the service was asked for anything but the row.
      for (const [name, spy] of Object.entries(evaluationService)) {
        if (name === 'getById' || name === 'list') continue;
        expect(spy).not.toHaveBeenCalled();
      }

      expect(await refusal(() => read(`eval-of-${RANCH}`, req(OWNER)))).toBe(
        'answered',
      );
      expect(await refusal(() => read(`eval-of-${A}`, req(ADMIN)))).toBe(
        'answered',
      );
    },
  );

  const BY_SCENARIO: Array<
    [string, (id: string, r: Request) => Promise<unknown>]
  > = [
    ['GET :id', (id, r) => scenarios.findById(id, r)],
    ['PATCH :id', (id, r) => scenarios.update(id, {} as never, r)],
    ['DELETE :id', (id, r) => scenarios.remove(id, r)],
  ];

  it.each(BY_SCENARIO)(
    'paddock-scenarios %s: a scenario of the assistant is a 404 to an Admin, as one that does not exist',
    async (_route, read) => {
      const ofAssistant = await refusal(() =>
        read(`scenario-of-${RANCH}`, req(ADMIN2)),
      );

      expect(ofAssistant).toBe(await refusal(() => read('nope', req(ADMIN2))));
      expect(ofAssistant).toMatch(/^404: /);
      expect(scenarioGateway.update).not.toHaveBeenCalled();
      expect(scenarioGateway.delete).not.toHaveBeenCalled();

      expect(
        await refusal(() => read(`scenario-of-${RANCH}`, req(OWNER))),
      ).toBe('answered');
      expect(
        await refusal(() => read('scenario-of-template', req(ADMIN2))),
      ).toBe('answered');
    },
  );
});
