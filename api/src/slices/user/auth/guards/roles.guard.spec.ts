import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRoleTypes } from '../../user/domain';
import { AnyBearer } from './anyBearer.decorator';
import { Public } from './public.decorator';
import { Roles } from './roles.decorator';
import {
  DEFAULT_ROUTE_ROLES,
  heldRoles,
  requiredRoles,
  RolesGuard,
} from './roles.guard';

/**
 * RolesGuard as a global guard (CLEAN-232): a route with no `@Roles` asks for
 * Admin, and an agent runtime's token is an Agent whatever it carries.
 */

class Routes {
  unstated() {}

  @Roles()
  emptyRoles() {}

  @Roles(UserRoleTypes.User)
  forUsers() {}

  @Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)
  forAdmins() {}

  @Roles(UserRoleTypes.Owner)
  forTheOwner() {}

  @Roles(UserRoleTypes.Owner, UserRoleTypes.Admin, UserRoleTypes.Agent)
  forAdminsAndAgents() {}

  @AnyBearer()
  forAnyBearer() {}

  @Public()
  open() {}
}

@Roles(UserRoleTypes.User)
class UserController {
  inherits() {}

  @Roles(UserRoleTypes.Owner)
  overrides() {}
}

@Public()
class OpenController {
  anything() {}
}

const guard = new RolesGuard(new Reflector());

type Handlers<T> = {
  [K in keyof T]: T[K] extends (...args: never[]) => unknown ? K : never;
}[keyof T];

function run<T extends object>(
  controller: new () => T,
  handler: Handlers<T>,
  user: unknown,
): boolean {
  const context = {
    getHandler: () =>
      (controller.prototype as Record<string, unknown>)[handler as string],
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
  try {
    return guard.canActivate(context);
  } catch (e) {
    if (e instanceof ForbiddenException) return false;
    throw e;
  }
}

const person = (role: UserRoleTypes) => ({
  sub: `user-${role}`,
  email: '',
  roles: [role],
});
const owner = person(UserRoleTypes.Owner);
const admin = person(UserRoleTypes.Admin);
const user = person(UserRoleTypes.User);
const plainAgent = {
  sub: 'agent:helper',
  email: '',
  roles: [UserRoleTypes.Agent],
};
/** The Ranch admin agent: its token carries Owner. */
const ranchAgent = {
  sub: 'agent:ranch',
  email: '',
  roles: [UserRoleTypes.Owner],
};
const everyone = { owner, admin, user, plainAgent, ranchAgent };

function who<T extends object>(
  controller: new () => T,
  handler: Handlers<T>,
): string[] {
  return Object.entries(everyone)
    .filter(([, bearer]) => run(controller, handler, bearer))
    .map(([name]) => name);
}

describe('a route with no @Roles asks for Admin', () => {
  it('admits an Owner and an Admin, refuses a User and both kinds of agent', () => {
    expect(who(Routes, 'unstated')).toEqual(['owner', 'admin']);
  });

  it('an empty @Roles() states nothing and is read as the default too', () => {
    expect(who(Routes, 'emptyRoles')).toEqual(['owner', 'admin']);
    expect(requiredRoles([])).toEqual(DEFAULT_ROUTE_ROLES);
    expect(requiredRoles(undefined)).toEqual([UserRoleTypes.Admin]);
    expect(requiredRoles(null)).toEqual([UserRoleTypes.Admin]);
  });

  it('refuses a valid token that holds no role, an unknown role, or no bearer', () => {
    expect(run(Routes, 'unstated', { sub: 'user-x', roles: [] })).toBe(false);
    expect(run(Routes, 'unstated', { sub: 'user-x' })).toBe(false);
    expect(run(Routes, 'unstated', { sub: 'user-x', roles: ['Root'] })).toBe(
      false,
    );
    expect(run(Routes, 'unstated', { sub: 'user-x', roles: 'Owner' })).toBe(
      false,
    );
    expect(run(Routes, 'unstated', undefined)).toBe(false);
    expect(run(Routes, 'forUsers', undefined)).toBe(false);
  });
});

describe('stated roles', () => {
  it('User: every person, no agent', () => {
    expect(who(Routes, 'forUsers')).toEqual(['owner', 'admin', 'user']);
  });

  it('Owner, Admin: as before the guard was global', () => {
    expect(who(Routes, 'forAdmins')).toEqual(['owner', 'admin']);
  });

  it('Owner: the Owner alone, and not an agent whose token says Owner', () => {
    expect(who(Routes, 'forTheOwner')).toEqual(['owner']);
  });

  it('a class’s roles apply to its handlers, and a handler’s own win', () => {
    expect(who(UserController, 'inherits')).toEqual(['owner', 'admin', 'user']);
    expect(who(UserController, 'overrides')).toEqual(['owner']);
  });
});

describe('an agent runtime’s token is an Agent on routes', () => {
  it('reads `agent:` subjects as Agent, whatever roles the token carries', () => {
    expect(heldRoles(ranchAgent)).toEqual([UserRoleTypes.Agent]);
    expect(heldRoles(plainAgent)).toEqual([UserRoleTypes.Agent]);
    expect(heldRoles({ sub: 'agent:x', roles: [UserRoleTypes.Admin] })).toEqual(
      [UserRoleTypes.Agent],
    );
    // A person keeps what the token states.
    expect(heldRoles(owner)).toEqual([UserRoleTypes.Owner]);
    expect(heldRoles({ sub: 'user-1', roles: undefined as never })).toEqual([]);
    expect(heldRoles(undefined)).toEqual([]);
    expect(heldRoles(null)).toEqual([]);
  });

  it('the Ranch admin agent’s token opens no Owner or Admin route', () => {
    expect(run(Routes, 'forTheOwner', ranchAgent)).toBe(false);
    expect(run(Routes, 'forAdmins', ranchAgent)).toBe(false);
    expect(run(Routes, 'forUsers', ranchAgent)).toBe(false);
    expect(run(Routes, 'unstated', ranchAgent)).toBe(false);
  });

  it('is admitted where Agent is named, the Ranch admin agent like any other', () => {
    expect(who(Routes, 'forAdminsAndAgents')).toEqual([
      'owner',
      'admin',
      'plainAgent',
      'ranchAgent',
    ]);
  });

  it('@AnyBearer admits every person and every agent, and still no role-less token', () => {
    expect(who(Routes, 'forAnyBearer')).toEqual([
      'owner',
      'admin',
      'user',
      'plainAgent',
      'ranchAgent',
    ]);
    expect(run(Routes, 'forAnyBearer', { sub: 'user-x', roles: [] })).toBe(
      false,
    );
    expect(run(Routes, 'forAnyBearer', undefined)).toBe(false);
  });
});

describe('@Public() routes are skipped', () => {
  it('a public handler passes with no bearer: the machine guard, if any, decides', () => {
    expect(run(Routes, 'open', undefined)).toBe(true);
    expect(run(OpenController, 'anything', undefined)).toBe(true);
  });

  it('and with one, whatever it holds', () => {
    expect(who(Routes, 'open')).toEqual(Object.keys(everyone));
  });
});

describe('running twice changes nothing', () => {
  // Controllers that still say @UseGuards(JwtAuthGuard, RolesGuard) run the
  // guard after the global one has run.
  it.each([
    'unstated',
    'forUsers',
    'forAdmins',
    'forTheOwner',
    'forAdminsAndAgents',
    'forAnyBearer',
    'open',
  ] as const)('%s', (handler) => {
    for (const bearer of [...Object.values(everyone), undefined]) {
      const first = run(Routes, handler, bearer);
      expect(run(Routes, handler, bearer)).toBe(first);
    }
  });

  it('refuses with the same 403 both times', () => {
    const context = {
      getHandler: () =>
        Object.getOwnPropertyDescriptor(Routes.prototype, 'unstated')
          ?.value as unknown,
      getClass: () => Routes,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as unknown as ExecutionContext;
    expect(() => guard.canActivate(context)).toThrow('Insufficient role');
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
