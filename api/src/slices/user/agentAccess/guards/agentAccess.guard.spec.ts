import type { ExecutionContext } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Public } from '#/user/auth/guards';
import { UserRoleTypes } from '#/user/user/domain';
import { accessHarness } from '../domain/__fixtures__/agentAccess';
import { AgentAccessGuard, accessCallerOfBearer } from './agentAccess.guard';
import { AgentScoped } from './agentScoped.decorator';

/**
 * `@AgentScoped` and the guard that reads it (CLEAN-231): a person whose
 * access lists hide the agent a route names gets the 404 the route gives for
 * an agent that does not exist.
 *
 * Agents A, B, C. `user-u` is denied C; `user-l` is limited to A.
 */
const { service, gateway } = accessHarness();
gateway.seed('user-u', false, [{ agentId: 'C', list: 'denied' }]);
gateway.seed('user-l', true, [{ agentId: 'A', list: 'allowed' }]);
gateway.seed('user-o', true, [{ agentId: 'A', list: 'allowed' }]);

const guard = new AgentAccessGuard(new Reflector(), service);

class Routes {
  @AgentScoped('id')
  byId() {}

  @AgentScoped('agentId', { notFound: (id) => `Agent ${id} not found` })
  byAgentId() {}

  @AgentScoped('query.agentId')
  byQuery() {}

  @AgentScoped('body.agentId')
  byBody() {}

  unmarked() {}
}

@AgentScoped('agentId')
class ClassRoutes {
  list() {}

  @Public()
  signedLink() {}
}

const bearer = (sub: string, role: UserRoleTypes, extra = {}) => ({
  sub,
  email: '',
  roles: [role],
  ...extra,
});
const owner = bearer('user-o', UserRoleTypes.Owner);
const admin = bearer('user-l', UserRoleTypes.Admin);
const user = bearer('user-u', UserRoleTypes.User);

interface IRequestParts {
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: unknown;
}

async function answer<T extends object>(
  controller: new () => T,
  handler: keyof T & string,
  who: unknown,
  parts: IRequestParts,
): Promise<true | { status: number; message: string }> {
  const context = {
    getHandler: () =>
      (controller.prototype as Record<string, unknown>)[handler],
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => ({ user: who, ...parts }) }),
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

const NOT_FOUND = { status: 404, message: 'Agent not found' };

describe('AgentAccessGuard', () => {
  it('lets a person through for an agent they reach', async () => {
    expect(await answer(Routes, 'byId', user, { params: { id: 'A' } })).toBe(
      true,
    );
    expect(await answer(Routes, 'byId', admin, { params: { id: 'A' } })).toBe(
      true,
    );
  });

  it('answers a hidden agent with the 404 of an agent that does not exist', async () => {
    expect(await answer(Routes, 'byId', user, { params: { id: 'C' } })).toEqual(
      NOT_FOUND,
    );
    // A limited account: a hidden agent and an id that names nothing leave
    // through the same line.
    const hidden = await answer(Routes, 'byId', admin, { params: { id: 'B' } });
    const unknown = await answer(Routes, 'byId', admin, {
      params: { id: 'nope' },
    });
    expect(hidden).toEqual(NOT_FOUND);
    expect(unknown).toEqual(hidden);
  });

  it('says it in the route’s own words when the route has its own', async () => {
    expect(
      await answer(Routes, 'byAgentId', user, { params: { agentId: 'C' } }),
    ).toEqual({ status: 404, message: 'Agent C not found' });
  });

  it('reads the agent from the query, and lets a list with no filter through', async () => {
    expect(
      await answer(Routes, 'byQuery', user, { query: { agentId: 'C' } }),
    ).toEqual(NOT_FOUND);
    expect(
      await answer(Routes, 'byQuery', user, { query: { agentId: 'A' } }),
    ).toBe(true);
    // No filter: the route names no agent; its handler filters the list.
    expect(await answer(Routes, 'byQuery', user, { query: {} })).toBe(true);
    expect(await answer(Routes, 'byQuery', user, {})).toBe(true);
    // A repeated key is not one id, and names nothing this person reaches.
    expect(
      await answer(Routes, 'byQuery', user, { query: { agentId: ['A', 'C'] } }),
    ).toEqual(NOT_FOUND);
  });

  it('reads the agent from the body', async () => {
    expect(
      await answer(Routes, 'byBody', user, { body: { agentId: 'C' } }),
    ).toEqual(NOT_FOUND);
    expect(
      await answer(Routes, 'byBody', user, { body: { agentId: 'B' } }),
    ).toBe(true);
    // An id that names no agent is the same 404 for a person, also for one
    // whose lists would not hide it; the Owner is left to the handler.
    expect(
      await answer(Routes, 'byBody', user, { body: { agentId: 'nope' } }),
    ).toEqual(NOT_FOUND);
    expect(
      await answer(Routes, 'byBody', owner, { body: { agentId: 'nope' } }),
    ).toBe(true);
    expect(await answer(Routes, 'byBody', user, { body: {} })).toBe(true);
    expect(await answer(Routes, 'byBody', user, { body: undefined })).toBe(
      true,
    );
    expect(
      await answer(Routes, 'byBody', user, { body: { agentId: { $ne: 'C' } } }),
    ).toEqual(NOT_FOUND);
  });

  it('reads the parameter the route names, not another one', async () => {
    expect(
      await answer(Routes, 'byId', user, { params: { id: 'C', agentId: 'A' } }),
    ).toEqual(NOT_FOUND);
    // A route parameter is always there; without it nothing is reached.
    expect(await answer(Routes, 'byId', user, { params: {} })).toEqual(
      NOT_FOUND,
    );
  });

  it('never restricts the Owner, whatever lists the account still has', async () => {
    expect(await answer(Routes, 'byId', owner, { params: { id: 'C' } })).toBe(
      true,
    );
  });

  it('is not about callers that are not a person', async () => {
    const hidden = { params: { id: 'C' } };
    // An agent runtime, even one whose id reads like a restricted account.
    expect(
      await answer(
        Routes,
        'byId',
        bearer('agent:user-u', UserRoleTypes.Agent),
        hidden,
      ),
    ).toBe(true);
    expect(
      await answer(
        Routes,
        'byId',
        bearer('agent:ranch', UserRoleTypes.Owner),
        hidden,
      ),
    ).toBe(true);
    // An embed token carries a `typ`; it is no console account.
    expect(
      await answer(
        Routes,
        'byId',
        bearer('user-u', UserRoleTypes.User, { typ: 'embed' }),
        hidden,
      ),
    ).toBe(true);
    // No bearer at all: the JWT guard's business, not this one's.
    expect(await answer(Routes, 'byId', undefined, hidden)).toBe(true);
  });

  it('leaves an unmarked route alone', async () => {
    expect(
      await answer(Routes, 'unmarked', user, { params: { id: 'C' } }),
    ).toBe(true);
  });

  it('a class marker covers its routes, except the @Public() ones', async () => {
    expect(
      await answer(ClassRoutes, 'list', user, { params: { agentId: 'C' } }),
    ).toEqual(NOT_FOUND);
    expect(
      await answer(ClassRoutes, 'signedLink', undefined, {
        params: { agentId: 'C' },
      }),
    ).toBe(true);
  });
});

describe('accessCallerOfBearer', () => {
  it('a person’s own token is that person, with their strongest role', () => {
    expect(
      accessCallerOfBearer({
        sub: 'user-1',
        roles: [UserRoleTypes.User, UserRoleTypes.Admin],
      }),
    ).toEqual({ kind: 'person', userId: 'user-1', role: UserRoleTypes.Admin });
  });

  it('anything else is nobody', () => {
    const guest = { kind: 'guest' };
    expect(accessCallerOfBearer(undefined)).toEqual(guest);
    expect(accessCallerOfBearer({ sub: '', roles: [] })).toEqual(guest);
    expect(
      accessCallerOfBearer({ sub: 'agent:a', roles: [UserRoleTypes.Owner] }),
    ).toEqual(guest);
    expect(
      accessCallerOfBearer({
        sub: 'user-1',
        roles: [UserRoleTypes.User],
        typ: 'embed',
      }),
    ).toEqual(guest);
    expect(
      accessCallerOfBearer({ sub: 'user-1', roles: [UserRoleTypes.Agent] }),
    ).toEqual(guest);
  });
});
