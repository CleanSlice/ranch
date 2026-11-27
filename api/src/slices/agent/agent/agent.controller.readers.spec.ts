import type { Request } from 'express';
import { NotFoundException } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { permissionOver } from './domain/__fixtures__/agentPermission';
import { READER_HIDDEN_FIELDS, toReaderView } from './domain/agentReaderView';
import type { IAgentData } from './domain/agent.types';
import type { IAgentPinGateway } from '#/agent/pin/domain/agentPin.gateway';
import type { AgentAccessService } from '#/user/agentAccess/domain/agentAccess.service';
import {
  accessHarness,
  openAccess,
} from '#/user/agentAccess/domain/__fixtures__/agentAccess';

/**
 * What a reader gets of an agent they may not manage, and the three routes
 * of `AgentController` that ask the manage rule in the handler (CLEAN-232):
 *
 * - `GET /agents`, `GET /agents/:id`, `GET /agents/status` and
 *   `GET /agents/public` used to send every reader the operator's view;
 * - `GET /agents/:id/mcps` is read by a runtime about itself and by a person
 *   who manages the agent, and by nobody else;
 * - `POST /agents/restart-by-template/:templateId` restarts only what the
 *   caller may manage.
 */

const row = (over: Partial<IAgentData>): IAgentData => ({
  id: 'ag',
  name: 'Agent',
  templateId: 'tpl-1',
  llmCredentialId: 'llm-1',
  status: 'failed',
  statusReason: 'ImagePullBackOff',
  workflowId: 'wf-1',
  firstDeployedAt: new Date('2026-11-01T10:00:00Z'),
  lastDeployStartedAt: new Date('2026-11-02T10:00:00Z'),
  launchContext: 'restart',
  lastPullAt: new Date('2026-11-03T10:00:00Z'),
  lastSyncAt: new Date('2026-11-04T10:00:00Z'),
  config: { systemPromptOverride: 'internal', webhook: 'https://hooks.test/x' },
  resources: { cpu: '500m', memory: '512Mi' },
  debugEnabled: true,
  isPublic: false,
  allowedOrigins: ['https://site.test'],
  knowledgeIds: ['knowledge-1'],
  isAdmin: false,
  pinned: true,
  createdById: null,
  createdAt: new Date('2026-10-01T10:00:00Z'),
  updatedAt: new Date('2026-10-02T10:00:00Z'),
  ...over,
});

const AGENTS: IAgentData[] = [
  row({ id: 'ag-plain', name: 'Support' }),
  row({ id: 'ag-ranch', name: 'Ranch', isAdmin: true }),
  row({ id: 'ag-mine', name: 'Mine', createdById: 'user-u' }),
];

const as = (sub: string, role: string) =>
  ({ user: { sub, email: '', roles: [role] } }) as unknown as Request;
const owner = as('user-o', 'Owner');
const admin = as('user-a', 'Admin');
const user = as('user-u', 'User');
const otherUser = as('user-x', 'User');
const agentToken = (id: string, role = 'Agent') => as(`agent:${id}`, role);

/** What a reader is left with of the operator's fields. */
const EMPTIED = {
  llmCredentialId: null,
  statusReason: null,
  workflowId: null,
  firstDeployedAt: null,
  lastDeployStartedAt: null,
  launchContext: null,
  lastPullAt: null,
  lastSyncAt: null,
  config: {},
  debugEnabled: false,
  knowledgeIds: [],
};
const operatorFieldsOf = (agent: object) =>
  Object.fromEntries(
    READER_HIDDEN_FIELDS.map((key) => [
      key,
      (agent as Record<string, unknown>)[key],
    ]),
  );
const isWhole = (agent: object) =>
  (agent as { config: Record<string, unknown> }).config.webhook !== undefined;

// The access lists hide nothing and nobody has pinned anything, unless a
// test hands in its own.
function build(
  agents: IAgentData[] = AGENTS,
  opts: { access?: AgentAccessService; pinned?: Record<string, string[]> } = {},
) {
  const pins = {
    pinnedIds: jest.fn((userId: string) =>
      Promise.resolve(new Set(opts.pinned?.[userId] ?? [])),
    ),
  };
  const agentGateway = {
    findAdmin: jest.fn(() =>
      Promise.resolve(agents.find((a) => a.isAdmin) ?? null),
    ),
    findAll: jest.fn(() => Promise.resolve(agents)),
    findPublic: jest.fn(() => Promise.resolve(agents)),
    findById: jest.fn((id: string) =>
      Promise.resolve(agents.find((a) => a.id === id) ?? null),
    ),
    findByTemplateId: jest.fn(() => Promise.resolve(agents)),
  };
  const statusService = {
    snapshot: jest.fn(() =>
      Promise.resolve(
        agents.map((agent) => ({ agent, pod: null, bridleConnected: false })),
      ),
    ),
  };
  const deploy = {
    restartAgent: jest.fn((_id: string) => Promise.resolve()),
  };
  const mcpResolver = {
    resolveForAgent: jest.fn(() =>
      Promise.resolve([
        {
          id: 'mcp-1',
          name: 'ranch',
          transport: 'streamableHttp',
          url: 'http://api/mcp/mcp',
          authType: 'bearer',
          authValue: 'OWNER_LEVEL_TOKEN',
        },
      ]),
    ),
  };
  const userGateway = { findById: jest.fn(() => Promise.resolve(null)) };
  const stub = {} as never;
  const controller = new AgentController(
    agentGateway as never,
    stub,
    stub,
    statusService as never,
    stub,
    stub,
    deploy as never,
    mcpResolver as never,
    stub,
    userGateway as never,
    permissionOver(agentGateway),
    opts.access ?? openAccess(),
    pins as unknown as IAgentPinGateway,
    { summary: () => null, detail: () => null } as never,
  );
  return { controller, agentGateway, deploy, mcpResolver, pins };
}

describe('toReaderView', () => {
  it('empties the operator’s fields and nothing else', () => {
    const agent = row({ id: 'ag-1' });
    const view = toReaderView(agent);

    expect(operatorFieldsOf(view)).toEqual(EMPTIED);
    // What the user console draws is untouched.
    const { id, name, templateId, status, resources, isPublic } = view;
    expect({ id, name, templateId, status, resources, isPublic }).toEqual({
      id: 'ag-1',
      name: 'Agent',
      templateId: 'tpl-1',
      status: 'failed',
      resources: { cpu: '500m', memory: '512Mi' },
      isPublic: false,
    });
    expect(view.allowedOrigins).toEqual(['https://site.test']);
    expect(view.isAdmin).toBe(false);
    expect(view.pinned).toBe(true);
    expect(view.createdAt).toEqual(agent.createdAt);
    expect(view.updatedAt).toEqual(agent.updatedAt);
    // The same keys as the row: one response shape for every reader.
    expect(Object.keys(view).sort()).toEqual(Object.keys(agent).sort());
  });

  it('names every field it empties, so the list cannot fall behind', () => {
    const agent = row({});
    const view = toReaderView(agent) as unknown as Record<string, unknown>;
    const changed = Object.keys(agent).filter(
      (key) =>
        JSON.stringify(view[key]) !==
        JSON.stringify((agent as unknown as Record<string, unknown>)[key]),
    );
    expect(changed.sort()).toEqual([...READER_HIDDEN_FIELDS].sort());
  });

  it('does not change the row it was given', () => {
    const agent = row({});
    toReaderView(agent);
    expect(agent.config).toEqual({
      systemPromptOverride: 'internal',
      webhook: 'https://hooks.test/x',
    });
  });
});

describe('AgentController — what each reader gets of an agent', () => {
  const wholeIds = (list: object[]) =>
    list.filter(isWhole).map((a) => (a as { id: string }).id);

  it('a User gets no agent’s configuration, only the one they created', async () => {
    const { controller } = build();

    const listed = await controller.findAll(user);

    expect(listed.map((a) => a.id)).toEqual([
      'ag-plain',
      'ag-ranch',
      'ag-mine',
    ]);
    expect(wholeIds(listed)).toEqual(['ag-mine']);
    expect(operatorFieldsOf(listed[0])).toEqual(EMPTIED);
    expect(operatorFieldsOf(listed[1])).toEqual(EMPTIED);
    // Nothing of the operator's view is left anywhere in the two others.
    const text = JSON.stringify([listed[0], listed[1]]);
    for (const secret of ['hooks.test', 'llm-1', 'wf-1', 'ImagePullBackOff']) {
      expect(text).not.toContain(secret);
    }
    expect(wholeIds(await controller.findAll(otherUser))).toEqual([]);
  });

  it('an Admin gets every agent whole except the Ranch admin agent', async () => {
    const { controller } = build();

    const listed = await controller.findAll(admin);

    expect(wholeIds(listed)).toEqual(['ag-plain', 'ag-mine']);
    expect(operatorFieldsOf(listed[1])).toEqual(EMPTIED);
    // Still there, and still marked, so the console can say whose it is.
    expect(listed[1].isAdmin).toBe(true);
  });

  it('the Owner gets every agent whole', async () => {
    const { controller } = build();
    expect(wholeIds(await controller.findAll(owner))).toEqual([
      'ag-plain',
      'ag-ranch',
      'ag-mine',
    ]);
  });

  it('GET /agents/:id answers the same way as the list', async () => {
    const { controller } = build();
    const one = async (id: string, who: Request) =>
      isWhole((await controller.findById(id, who)) as object);

    expect(await one('ag-plain', user)).toBe(false);
    expect(await one('ag-mine', user)).toBe(true);
    expect(await one('ag-ranch', admin)).toBe(false);
    expect(await one('ag-plain', admin)).toBe(true);
    expect(await one('ag-ranch', owner)).toBe(true);
  });

  it('GET /agents/status carries the same view of each agent', async () => {
    const { controller } = build();

    const forUser = await controller.status(user);
    const forOwner = await controller.status(owner);

    expect(wholeIds(forUser.map((s) => s.agent))).toEqual(['ag-mine']);
    expect(wholeIds(forOwner.map((s) => s.agent))).toHaveLength(3);
    for (const s of forUser) expect(s.agent).not.toHaveProperty('createdById');
  });

  it('every reader is told whether they created the agent, and a User nothing else about creators (CLEAN-259)', async () => {
    const { controller } = build();
    const mineOf = (list: { id: string; createdByMe: boolean }[]) =>
      list.filter((a) => a.createdByMe).map((a) => a.id);

    const forUser = await controller.findAll(user);
    expect(mineOf(forUser)).toEqual(['ag-mine']);
    // The creator's own flag is all a User gets: no name, no id, of anybody.
    for (const agent of forUser) {
      expect(agent.createdBy).toBeNull();
      expect(agent).not.toHaveProperty('createdById');
    }
    expect(JSON.stringify(forUser)).not.toContain('user-u');

    // Somebody else's agent is not theirs, whatever their role.
    expect(mineOf(await controller.findAll(otherUser))).toEqual([]);
    expect(mineOf(await controller.findAll(admin))).toEqual([]);
    expect(mineOf(await controller.findAll(owner))).toEqual([]);
    // An operator still reads who it was.
    const forAdmin = await controller.findAll(admin);
    expect(forAdmin[2].createdBy).toEqual({
      id: 'user-u',
      name: null,
      email: null,
    });
    // Nobody is recorded: nobody's, the reader's included.
    expect(forUser[0].createdByMe).toBe(false);

    // The same answer from the routes that return one agent, and in status.
    expect((await controller.findById('ag-mine', user))?.createdByMe).toBe(
      true,
    );
    expect((await controller.findById('ag-mine', admin))?.createdByMe).toBe(
      false,
    );
    const status = await controller.status(user);
    expect(
      status.filter((s) => s.agent.createdByMe).map((s) => s.agent.id),
    ).toEqual(['ag-mine']);

    // Not a person: an agent's token, nobody at all, the public page.
    expect(mineOf(await controller.findAll(agentToken('user-u')))).toEqual([]);
    expect(mineOf(await controller.findAll(undefined))).toEqual([]);
    expect(mineOf(await controller.findPublic())).toEqual([]);
  });

  it('an anonymous reader and an agent’s token get the reader view of everything', async () => {
    const { controller } = build();

    expect(wholeIds(await controller.findPublic())).toEqual([]);
    expect(wholeIds(await controller.findAll(undefined))).toEqual([]);
    // The Ranch admin agent's token carries Owner; on a route it is nobody.
    expect(
      wholeIds(await controller.findAll(agentToken('ag-ranch', 'Owner'))),
    ).toEqual([]);
  });
});

describe('AgentController — the caller’s own pins and reach (CLEAN-231)', () => {
  const ids = (list: { id: string }[]) => list.map((a) => a.id);
  const pinnedIds = (list: { id: string; pinned?: boolean }[]) =>
    ids(list.filter((a) => a.pinned));

  it('`pinned` is what this caller pinned, and false for a caller who is nobody', async () => {
    // Every row says `pinned: true`, as a stale column would: the answer
    // comes from the caller's pins and from nowhere else.
    const { controller, pins } = build(AGENTS, {
      pinned: { 'user-u': ['ag-plain'], 'user-a': ['ag-mine', 'ag-ranch'] },
    });

    expect(pinnedIds(await controller.findAll(user))).toEqual(['ag-plain']);
    // The Admin pinned the Ranch assistant too, before CLEAN-269. It is
    // first in every list as it is, so the pin is not shown: the row stays
    // in the table and no answer carries it.
    expect(pinnedIds(await controller.findAll(admin))).toEqual(['ag-mine']);
    expect((await controller.findById('ag-ranch', admin))?.pinned).toBe(false);
    expect(
      pinnedIds((await controller.status(admin)).map((s) => s.agent)),
    ).toEqual(['ag-mine']);
    expect(pinnedIds(await controller.findAll(otherUser))).toEqual([]);
    expect(
      pinnedIds((await controller.status(user)).map((s) => s.agent)),
    ).toEqual(['ag-plain']);
    expect((await controller.findById('ag-plain', user))?.pinned).toBe(true);
    expect((await controller.findById('ag-plain', admin))?.pinned).toBe(false);

    // An agent's token, an anonymous reader: no person, so no pins are read.
    pins.pinnedIds.mockClear();
    expect(pinnedIds(await controller.findAll(agentToken('ag-plain')))).toEqual(
      [],
    );
    expect(pinnedIds(await controller.findAll(undefined))).toEqual([]);
    expect(pinnedIds(await controller.findPublic())).toEqual([]);
    expect(pins.pinnedIds).not.toHaveBeenCalled();
  });

  it('an agent the caller’s access lists hide is not in the lists, for that caller only', async () => {
    const { gateway, service } = accessHarness(AGENTS.map((a) => a.id));
    gateway.seed('user-u', false, [{ agentId: 'ag-plain', list: 'denied' }]);
    gateway.seed('user-a', false, [{ agentId: 'ag-ranch', list: 'denied' }]);
    const { controller } = build(AGENTS, { access: service });

    expect(ids(await controller.findAll(user))).toEqual([
      'ag-ranch',
      'ag-mine',
    ]);
    expect(ids((await controller.status(user)).map((s) => s.agent))).toEqual([
      'ag-ranch',
      'ag-mine',
    ]);
    // Somebody else's lists, and the Owner, who has none.
    expect(ids(await controller.findAll(otherUser))).toHaveLength(3);
    expect(ids(await controller.findAll(owner))).toHaveLength(3);

    // The Ranch admin agent is addressed by a flag, so the route asks itself.
    await expect(controller.findAdmin(admin)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect((await controller.findAdmin(owner))?.id).toBe('ag-ranch');
  });
});

describe('AgentController.getMcps — who may read the list (CLEAN-232)', () => {
  const answer = async (id: string, who: Request) => {
    const { controller, mcpResolver } = build();
    try {
      const list = await controller.getMcps(id, who as never);
      return { ok: list.length, asked: mcpResolver.resolveForAgent.mock.calls };
    } catch (e) {
      if (!(e instanceof NotFoundException)) throw e;
      return { status: 404, message: e.message, asked: [] };
    }
  };
  const NOT_FOUND = { status: 404, message: 'Agent not found', asked: [] };

  it('an Admin cannot read the Ranch admin agent’s servers, and is told what an unknown id is told', async () => {
    expect(await answer('ag-ranch', admin)).toEqual(NOT_FOUND);
    expect(await answer('nope', admin)).toEqual(NOT_FOUND);
  });

  it('an Admin reads an ordinary agent’s, the Owner reads any', async () => {
    expect((await answer('ag-plain', admin)).ok).toBe(1);
    expect((await answer('ag-ranch', owner)).ok).toBe(1);
  });

  it('a person below Admin reads only an agent they manage', async () => {
    // The route's role stops a User before this; the handler agrees anyway.
    expect(await answer('ag-plain', user)).toEqual(NOT_FOUND);
    expect((await answer('ag-mine', user)).ok).toBe(1);
  });

  it('a runtime still reads its own list, the Ranch admin agent’s included', async () => {
    expect((await answer('ag-plain', agentToken('ag-plain'))).ok).toBe(1);
    expect((await answer('ag-ranch', agentToken('ag-ranch', 'Owner'))).ok).toBe(
      1,
    );
  });

  it('a request with no bearer behind it reads nothing', async () => {
    expect(await answer('ag-plain', {} as Request)).toEqual(NOT_FOUND);
  });
});

describe('AgentController.restartByTemplate — agents the caller may not manage', () => {
  it('an Admin restarts the rest and is told how many were left, not which', async () => {
    const { controller, deploy } = build();

    const result = await controller.restartByTemplate('tpl-1', admin);

    expect(deploy.restartAgent.mock.calls.map(([id]) => id).sort()).toEqual([
      'ag-mine',
      'ag-plain',
    ]);
    expect(result).toEqual({ restarted: 2, failed: 0, total: 2, skipped: 1 });
  });

  it('the Owner restarts all of them', async () => {
    const { controller, deploy } = build();

    const result = await controller.restartByTemplate('tpl-1', owner);

    expect(deploy.restartAgent).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ restarted: 3, failed: 0, total: 3, skipped: 0 });
  });

  it('restarts nothing for a template whose only agent is the Ranch admin agent', async () => {
    const { controller, deploy } = build([AGENTS[1]]);

    const result = await controller.restartByTemplate('tpl-1', admin);

    expect(deploy.restartAgent).not.toHaveBeenCalled();
    expect(result).toEqual({ restarted: 0, failed: 0, total: 0, skipped: 1 });
  });

  it('an empty template is still an empty answer', async () => {
    const { controller } = build([]);
    expect(await controller.restartByTemplate('tpl-1', owner)).toEqual({
      restarted: 0,
      failed: 0,
      total: 0,
      skipped: 0,
    });
  });
});

// CLEAN-240: who has the assistant is a switch of its own. The route is the
// same for every role; the lists of ordinary agents no longer decide it.
describe('GET /agents/admin/current follows the assistant switch', () => {
  const withSwitch = (off: string[]) => {
    const { gateway, service } = accessHarness(AGENTS.map((a) => a.id));
    service.attachAssistant({
      assistantId: async () => 'ag-ranch',
      forPerson: async ({ userId }) => ({
        id: 'ag-ranch',
        enabled: !off.includes(userId),
      }),
    });
    return { gateway, ...build(AGENTS, { access: service }) };
  };

  it('an account limited to other agents still gets it', async () => {
    const { gateway, controller } = withSwitch([]);
    gateway.seed('user-a', true, [{ agentId: 'ag-plain', list: 'allowed' }]);
    expect((await controller.findAdmin(admin))?.id).toBe('ag-ranch');
  });

  it('a User it is on for gets it, as a reader', async () => {
    const { controller } = withSwitch([]);
    const dto = await controller.findAdmin(user);
    expect(dto?.id).toBe('ag-ranch');
    // The assistant is the Owner's to manage: nobody else reads its config.
    expect(dto?.config ?? {}).toEqual({});
  });

  it('switched off, it is not found, and is not in the list either', async () => {
    const { controller } = withSwitch(['user-u']);
    await expect(controller.findAdmin(user)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect((await controller.findAll(user)).map((a) => a.id)).not.toContain(
      'ag-ranch',
    );
    expect((await controller.findAdmin(owner))?.id).toBe('ag-ranch');
  });
});
