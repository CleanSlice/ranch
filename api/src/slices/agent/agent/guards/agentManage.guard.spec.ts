import type { ExecutionContext } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  appRoutes,
  type IRouteRow,
} from '#/user/auth/guards/__fixtures__/routeTable';
import { Public } from '#/user/auth/guards';
import { UserRoleTypes } from '#/user/user/domain';
import type { IAgentGateway } from '../domain/agent.gateway';
import type { IAgentData } from '../domain/agent.types';
import {
  AgentPermissionService,
  OpenAgentReach,
} from '../domain/agentPermission.service';
import {
  AgentManageGuard,
  ManagesAgent,
  MANAGES_AGENT_METADATA_KEY,
} from './agentManage.guard';

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

/**
 * `@ManagesAgent` and the guard that reads it (CLEAN-232): the management
 * routes of one agent ask `AgentPermissionService.canManage`, and answer the
 * 404 of an unknown agent to a caller who may not.
 */

const AGENTS: IAgentData[] = [
  { id: 'agent-1', isAdmin: false, createdById: null },
  { id: 'agent-ranch', isAdmin: true, createdById: null },
  { id: 'agent-mine', isAdmin: false, createdById: 'user-u' },
] as IAgentData[];

const gateway = {
  findById: (id: string) =>
    Promise.resolve(AGENTS.find((a) => a.id === id) ?? null),
  hasCreatedBy: () => Promise.resolve(false),
} as unknown as IAgentGateway;

const guard = new AgentManageGuard(
  new Reflector(),
  new AgentPermissionService(gateway, new OpenAgentReach()),
);

class AgentRoutes {
  @ManagesAgent('id')
  byId() {}

  @ManagesAgent('agentId')
  byAgentId() {}

  unmarked() {}
}

@ManagesAgent('agentId')
class WorkspaceRoutes {
  list() {}

  @Public()
  signedLink() {}
}

const bearer = (sub: string, role: UserRoleTypes) => ({
  sub,
  email: '',
  roles: [role],
});
const owner = bearer('user-o', UserRoleTypes.Owner);
const admin = bearer('user-a', UserRoleTypes.Admin);
const user = bearer('user-u', UserRoleTypes.User);

function contextOf(
  targets: { handler: unknown; controller: unknown },
  user: unknown,
  params: Record<string, string>,
): ExecutionContext {
  return {
    getHandler: () => targets.handler,
    getClass: () => targets.controller,
    switchToHttp: () => ({ getRequest: () => ({ user, params }) }),
  } as unknown as ExecutionContext;
}

async function answer<T extends object>(
  controller: new () => T,
  handler: keyof T & string,
  who: unknown,
  params: Record<string, string>,
): Promise<true | { status: number; message: string }> {
  try {
    return (await guard.canActivate(
      contextOf(
        {
          handler: (controller.prototype as Record<string, unknown>)[handler],
          controller,
        },
        who,
        params,
      ),
    )) as true;
  } catch (e) {
    if (e instanceof NotFoundException) {
      return { status: e.getStatus(), message: e.message };
    }
    throw e;
  }
}

const NOT_FOUND = { status: 404, message: 'Agent not found' };

describe('AgentManageGuard', () => {
  it('lets a caller through for an agent they may manage', async () => {
    expect(await answer(AgentRoutes, 'byId', admin, { id: 'agent-1' })).toBe(
      true,
    );
    expect(
      await answer(AgentRoutes, 'byId', owner, { id: 'agent-ranch' }),
    ).toBe(true);
    expect(
      await answer(AgentRoutes, 'byAgentId', user, { agentId: 'agent-mine' }),
    ).toBe(true);
  });

  it('answers a refusal exactly as it answers an agent that does not exist', async () => {
    const unknown = await answer(AgentRoutes, 'byId', admin, { id: 'nope' });
    const refused = await answer(AgentRoutes, 'byId', admin, {
      id: 'agent-ranch',
    });
    expect(unknown).toEqual(NOT_FOUND);
    expect(refused).toEqual(unknown);
    // The same for a User and somebody else's agent.
    expect(await answer(AgentRoutes, 'byId', user, { id: 'agent-1' })).toEqual(
      NOT_FOUND,
    );
  });

  it('the Ranch admin agent is the Owner’s: an Admin gets the 404', async () => {
    expect(
      await answer(WorkspaceRoutes, 'list', admin, { agentId: 'agent-ranch' }),
    ).toEqual(NOT_FOUND);
    expect(
      await answer(WorkspaceRoutes, 'list', owner, { agentId: 'agent-ranch' }),
    ).toBe(true);
  });

  it('reads the parameter the route names, not another one', async () => {
    // `id` is what the marker names; a stray `agentId` is ignored.
    expect(
      await answer(AgentRoutes, 'byId', admin, {
        id: 'agent-ranch',
        agentId: 'agent-1',
      }),
    ).toEqual(NOT_FOUND);
    expect(await answer(AgentRoutes, 'byAgentId', admin, {})).toEqual(
      NOT_FOUND,
    );
  });

  it('an agent runtime’s token manages nothing here, whatever it carries', async () => {
    expect(
      await answer(
        AgentRoutes,
        'byId',
        bearer('agent:ranch', UserRoleTypes.Owner),
        { id: 'agent-1' },
      ),
    ).toEqual(NOT_FOUND);
    expect(
      await answer(AgentRoutes, 'byId', undefined, { id: 'agent-1' }),
    ).toEqual(NOT_FOUND);
  });

  it('leaves an unmarked route alone', async () => {
    expect(await answer(AgentRoutes, 'unmarked', user, { id: 'nope' })).toBe(
      true,
    );
    expect(await answer(AgentRoutes, 'unmarked', undefined, {})).toBe(true);
  });

  it('a class marker covers its routes, except the @Public() ones', async () => {
    expect(
      await answer(WorkspaceRoutes, 'list', user, { agentId: 'agent-1' }),
    ).toEqual(NOT_FOUND);
    // A signed link has no bearer; its own token is its credential.
    expect(
      await answer(WorkspaceRoutes, 'signedLink', undefined, {
        agentId: 'agent-ranch',
      }),
    ).toBe(true);
  });
});

/**
 * The management routes of one agent, pinned. A route that manages an agent
 * and is missing here is one an Admin can use on the Ranch admin agent:
 * its files are its instructions, its secrets and schedule are Owner power.
 * Adding or removing one is a decision; it shows up as a diff of this list.
 */
const EXPECTED: Record<string, 'id' | 'agentId'> = {
  // The agent itself.
  'PUT /agents/:id': 'id',
  'DELETE /agents/:id': 'id',
  'POST /agents/:id/restart': 'id',
  'POST /agents/:id/stop': 'id',
  'POST /agents/:id/start': 'id',
  // Channels: who it answers, with which bot tokens. Read and write.
  'GET /agents/:id/channels': 'id',
  'PUT /agents/:id/channels': 'id',
  // Workspace files. Reads too: they are its instructions and its memory.
  'GET /agents/:agentId/files': 'agentId',
  'GET /agents/:agentId/files/limits': 'agentId',
  'GET /agents/:agentId/files/content': 'agentId',
  'PUT /agents/:agentId/files/content': 'agentId',
  'DELETE /agents/:agentId/files/content': 'agentId',
  'DELETE /agents/:agentId/files': 'agentId',
  'POST /agents/:agentId/files/sync': 'agentId',
  'GET /agents/:agentId/files/export': 'agentId',
  'POST /agents/:agentId/files/export': 'agentId',
  'POST /agents/:agentId/files/open-link': 'agentId',
  'POST /agents/:agentId/files/import/stage': 'agentId',
  'POST /agents/:agentId/files/import/resolve': 'agentId',
  'POST /agents/:agentId/files/import/stage-files': 'agentId',
  'GET /agents/:agentId/files/import/:importId/plan': 'agentId',
  'POST /agents/:agentId/files/import/:importId/apply': 'agentId',
  'GET /agents/:agentId/files/proposals': 'agentId',
  'GET /agents/:agentId/files/proposals/:proposalId': 'agentId',
  'GET /agents/:agentId/files/proposals/:proposalId/content': 'agentId',
  'GET /agents/:agentId/files/proposals/:proposalId/diff': 'agentId',
  'POST /agents/:agentId/files/proposals/:proposalId/apply': 'agentId',
  'POST /agents/:agentId/files/proposals/:proposalId/skip': 'agentId',
  // Secrets, reads included.
  'GET /agents/:agentId/secrets': 'agentId',
  'PUT /agents/:agentId/secrets': 'agentId',
  'DELETE /agents/:agentId/secrets': 'agentId',
  'POST /agents/:agentId/secrets/replace': 'agentId',
  // Logs.
  'GET /agents/:agentId/logs': 'agentId',
  // Limits and peers: the writes.
  'PUT /agents/:agentId/limits': 'agentId',
  'POST /agents/:agentId/peers': 'agentId',
  'POST /agents/:agentId/peers/:peerId/refresh': 'agentId',
  'DELETE /agents/:agentId/peers/:peerId': 'agentId',
};

describe('the management routes of one agent', () => {
  const marked = (): IRouteRow[] =>
    appRoutes().filter(
      (row) =>
        !row.isPublic &&
        row.metadata<string>(MANAGES_AGENT_METADATA_KEY) !== undefined,
    );

  it('match the reviewed list exactly, each naming its parameter', () => {
    const actual = Object.fromEntries(
      marked().map((row) => [
        row.route,
        row.metadata<string>(MANAGES_AGENT_METADATA_KEY),
      ]),
    );
    expect(actual).toEqual(EXPECTED);
  });

  it('each names a parameter its own path has', () => {
    for (const row of marked()) {
      const param = row.metadata<string>(MANAGES_AGENT_METADATA_KEY);
      expect([row.route, row.route.includes(`/:${param}`)]).toEqual([
        row.route,
        true,
      ]);
    }
  });

  it('none of them is open below Admin: the role comes first, then the agent', () => {
    for (const row of marked()) {
      expect([row.route, row.roles.includes(UserRoleTypes.User)]).toEqual([
        row.route,
        false,
      ]);
      expect([row.route, row.roles.includes(UserRoleTypes.Agent)]).toEqual([
        row.route,
        false,
      ]);
    }
  });
});
