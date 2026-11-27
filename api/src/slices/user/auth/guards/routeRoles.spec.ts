import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRoleTypes } from '../../user/domain';
import {
  admits,
  appGlobalGuards,
  appRoutes,
  type IRouteRow,
} from './__fixtures__/routeTable';
import { ANY_BEARER_ROLES } from './anyBearer.decorator';
import { RolesGuard } from './roles.guard';

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
 * Every route asks for a role (CLEAN-232). The three pinned sets say what is
 * open to nobody-in-particular (publicRoutes.spec.ts), to a User
 * (userRoutes.spec.ts) and to an agent (agentRoutes.spec.ts). This is the
 * rest of the statement: outside the public set, no route lets a token
 * through for being valid alone, which is what 136 of 252 routes did.
 *
 * The real guard runs against the real metadata of every route the
 * application registers, so a route added tomorrow is covered the day it is
 * added.
 */

/** The guards that authenticate a caller that is not a person. */
const MACHINE_GUARDS = [
  'BridleApiKeyGuard',
  'ApiKeyGuard',
  'A2aPeerGuard',
  'A2aCardGuard',
];

const guard = new RolesGuard(new Reflector());

function contextFor(row: IRouteRow, user: unknown): ExecutionContext {
  return {
    getHandler: () => row.targets.handler,
    getClass: () => row.targets.controller,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

/** What the guard answers for this bearer on this route. */
function passes(row: IRouteRow, user: unknown): boolean {
  try {
    return guard.canActivate(contextFor(row, user));
  } catch (e) {
    if (e instanceof ForbiddenException) return false;
    throw e;
  }
}

const guarded = () => appRoutes().filter((row) => !row.isPublic);

describe('every route asks for a role', () => {
  it('registers the guards globally, in the order they depend on each other', () => {
    // JwtAuthGuard sets req.user, RolesGuard reads its role, AgentManageGuard
    // and AgentAccessGuard (CLEAN-231) read who it is, and so does
    // AssistantBuildGuard (CLEAN-271). A different order is a guard reading
    // nothing.
    expect(appGlobalGuards()).toEqual([
      'JwtAuthGuard',
      'RolesGuard',
      'AgentManageGuard',
      'AgentAccessGuard',
      'AssistantBuildGuard',
    ]);
  });

  it('no route lets a valid token through that holds no role', () => {
    const open = guarded()
      .filter(
        (row) =>
          passes(row, { sub: 'user-x', email: '', roles: [] }) ||
          passes(row, { sub: 'user-x', email: '' }) ||
          passes(row, { sub: 'user-x', email: '', roles: ['Guest'] }) ||
          passes(row, undefined),
      )
      .map((row) => row.route);
    expect(open).toEqual([]);
  });

  it('a route that states no role asks for Admin: closed to a User and to an agent', () => {
    const unstated = guarded().filter((row) => !row.statedRoles?.length);
    // The default is doing real work: most routes rely on it.
    expect(unstated.length).toBeGreaterThan(100);

    const user = { sub: 'user-u', email: '', roles: [UserRoleTypes.User] };
    const agent = { sub: 'agent:a', email: '', roles: [UserRoleTypes.Agent] };
    const admin = { sub: 'user-a', email: '', roles: [UserRoleTypes.Admin] };
    const owner = { sub: 'user-o', email: '', roles: [UserRoleTypes.Owner] };
    for (const row of unstated) {
      expect([row.route, passes(row, user)]).toEqual([row.route, false]);
      expect([row.route, passes(row, agent)]).toEqual([row.route, false]);
      expect([row.route, passes(row, admin)]).toEqual([row.route, true]);
      expect([row.route, passes(row, owner)]).toEqual([row.route, true]);
    }
  });

  it('an agent’s token carrying Owner opens exactly what an Agent token opens', () => {
    const asRanchAgent = {
      sub: 'agent:ranch',
      email: '',
      roles: [UserRoleTypes.Owner],
    };
    const opened = guarded()
      .filter((row) => passes(row, asRanchAgent))
      .map((row) => row.route)
      .sort();
    const agentSet = guarded()
      .filter((row) => admits(row, UserRoleTypes.Agent))
      .map((row) => row.route)
      .sort();
    expect(opened).toEqual(agentSet);
    // And nothing an Owner-only or Admin-only route protects.
    expect(opened).not.toContain('GET /users');
    expect(opened).not.toContain('GET /settings');
    expect(opened).not.toContain('PUT /users/:id/role');
  });

  it('nothing changes for an Admin: every route that is not Owner-only admits one', () => {
    const closedToAdmin = guarded()
      .filter((row) => !admits(row, UserRoleTypes.Admin))
      .map((row) => row.route)
      .sort();
    // The Owner's own decisions, each stated with @Roles(Owner).
    expect(closedToAdmin).toEqual(
      [
        'PUT /users/:id/role',
        'DELETE /users/:id',
        'PUT /agent-events/destination',
        'DELETE /agent-events/destination',
        'POST /agent-events/destination/test',
        // Which agent holds Owner power (CLEAN-232).
        'POST /agents/:id/promote-admin',
        'DELETE /agents/:id/promote-admin',
        // What a whole role gets from the assistant, and who differs from
        // their role (CLEAN-240). An Admin sets it for single Users only.
        'GET /assistant-access',
        'PUT /assistant-access/roles/:role',
        // Creating the template the Ranch assistant is made from: what the
        // assistant is built from is the Owner's (CLEAN-271). The writes to
        // an existing ingredient keep their Admin role and are refused per
        // resource (`@ChangesAssistantIngredient`, assistantBuildRoutes.spec).
        'POST /rancher/template',
      ].sort(),
    );
  });

  // The installation's statistics sit in the same slice as a route every
  // account may call (`GET /me/stats`), so the pair is pinned here by name
  // (CLEAN-265): what the agents cost and how they fared is the Owner's and
  // the Admins' to read, stated on the route and not left to the default.
  // Which agents an Admin sees there is their reach, applied in the handler
  // (the route names no agent, so agentScopedRoutes.spec.ts cannot find it;
  // installationStats.service.spec.ts holds that half).
  it('the installation’s statistics are for the Owner and Admins, stated, and closed to a User', () => {
    const row = appRoutes().find((r) => r.route === 'GET /stats/installation');
    expect(row).toBeDefined();
    if (!row) return;
    expect(row.isPublic).toBe(false);
    expect(row.statedRoles).toEqual([UserRoleTypes.Owner, UserRoleTypes.Admin]);

    const token = (role: UserRoleTypes, sub = 'user-x') => ({
      sub,
      email: '',
      roles: [role],
    });
    expect(passes(row, token(UserRoleTypes.Owner))).toBe(true);
    expect(passes(row, token(UserRoleTypes.Admin))).toBe(true);
    expect(passes(row, token(UserRoleTypes.User))).toBe(false);
    // The Ranch admin agent's own token: an agent on a route, whatever
    // roles it carries. Its way to these figures is the tool.
    expect(passes(row, token(UserRoleTypes.Owner, 'agent:ranch'))).toBe(false);
    expect(passes(row, undefined)).toBe(false);

    // And the personal route beside it stays every account's.
    const mine = appRoutes().find((r) => r.route === 'GET /me/stats');
    expect(mine?.statedRoles).toEqual([UserRoleTypes.User]);
  });

  it('only the MCP endpoints are open to every bearer', () => {
    const anyBearer = guarded()
      .filter(
        (row) =>
          row.statedRoles?.length === ANY_BEARER_ROLES.length &&
          ANY_BEARER_ROLES.every((role) => row.statedRoles?.includes(role)),
      )
      .map((row) => row.route)
      .sort();
    expect(anyBearer).toEqual(
      [
        'POST /mcp/mcp',
        'GET /mcp/mcp',
        'DELETE /mcp/mcp',
        'GET /mcp/sse',
        'POST /mcp/messages',
      ].sort(),
    );
    // The session diagnostics beside them stay with an operator.
    const debug = appRoutes().find(
      (row) => row.route === 'GET /teams/:teamId/sessions/debug',
    );
    expect(debug?.statedRoles).toEqual([UserRoleTypes.Admin]);
  });
});

describe('machine routes are recognised by @Public()', () => {
  // RolesGuard skips @Public() routes and has no list of machine guards. That
  // is sound only while every route behind such a guard is public, which the
  // global JwtAuthGuard already forces: without @Public() it would refuse the
  // machine's credential as a bad JWT before the machine guard ran.
  it('every route behind a machine guard is @Public()', () => {
    const behindMachineGuard = appRoutes().filter((row) =>
      row.guards.some((name) => MACHINE_GUARDS.includes(name)),
    );
    expect(behindMachineGuard.length).toBeGreaterThan(10);
    expect(
      behindMachineGuard.filter((row) => !row.isPublic).map((row) => row.route),
    ).toEqual([]);
  });

  it('the role guard lets a public route through with no bearer at all', () => {
    for (const row of appRoutes().filter((r) => r.isPublic)) {
      expect([row.route, passes(row, undefined)]).toEqual([row.route, true]);
    }
  });
});
