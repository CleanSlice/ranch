import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import type { Request } from 'express';
import { ROLES_METADATA_KEY } from '#/user/auth/guards';
import type { IAuthTokenPayload } from '#/user/auth/domain/auth.types';
import { UserRoleTypes } from '#/user/user/domain';
import { AgentAccessController } from './agentAccess.controller';
import {
  ADMIN,
  ADMIN2,
  OWNER,
  USER,
  accessHarness,
} from './domain/__fixtures__/agentAccess';

/**
 * `GET` / `PUT /users/:id/agent-access` as contracts/http-api.md states
 * them: who may call, and each refusal with its status and `code`.
 */

type AuthedRequest = Request & { user?: IAuthTokenPayload };

const as = (p: { id: string; role: UserRoleTypes }): AuthedRequest =>
  ({ user: { sub: p.id, email: '', roles: [p.role] } }) as AuthedRequest;

function harness() {
  const h = accessHarness();
  return { ...h, controller: new AgentAccessController(h.service) };
}

/** The HTTP answer a refused call would be: status and body. */
async function refused(
  run: Promise<unknown>,
): Promise<{ status: number; body: unknown }> {
  try {
    await run;
  } catch (e) {
    if (e instanceof HttpException) {
      return { status: e.getStatus(), body: e.getResponse() };
    }
    throw e;
  }
  throw new Error('expected a refusal, the call went through');
}

const body = (
  allowed: string[],
  denied: string[],
  version: string | null = null,
  confirmOpen?: boolean,
) => ({ allowed, denied, version, ...(confirmOpen ? { confirmOpen } : {}) });

describe('AgentAccessController', () => {
  it('is for the Owner and Admins: a User sees no lists, their own included', () => {
    expect(
      Reflect.getMetadata(ROLES_METADATA_KEY, AgentAccessController),
    ).toEqual([UserRoleTypes.Admin]);
  });

  it('GET answers an untouched account as open, with no version', async () => {
    const { controller } = harness();
    expect(await controller.get(USER.id, as(OWNER))).toEqual({
      userId: USER.id,
      allowed: [],
      denied: [],
      outcome: { kind: 'all', count: 0 },
      needsReview: false,
      hasEntriesOutsideView: false,
      version: null,
    });
  });

  it('PUT saves and answers the new access with its version', async () => {
    const { controller } = harness();
    const saved = await controller.set(USER.id, body(['A'], ['B']), as(OWNER));
    expect(saved).toMatchObject({
      allowed: ['A'],
      denied: ['B'],
      outcome: { kind: 'only', count: 1 },
    });
    expect(saved.version).toEqual(expect.any(String));
    expect(await controller.get(USER.id, as(OWNER))).toEqual(saved);
  });

  it('403 ACCESS_NOT_EDITABLE: the Owner, the caller themselves, another Admin', async () => {
    const { controller } = harness();
    const none = body([], []);
    for (const [target, caller] of [
      [OWNER, OWNER],
      [OWNER, ADMIN],
      [ADMIN, ADMIN],
      [ADMIN2, ADMIN],
    ] as const) {
      const answer = await refused(controller.set(target.id, none, as(caller)));
      expect([target.id, caller.id, answer.status]).toEqual([
        target.id,
        caller.id,
        403,
      ]);
      expect(answer.body).toMatchObject({ code: 'ACCESS_NOT_EDITABLE' });
      // A sentence a person can act on.
      expect(
        (answer.body as { message: string }).message.length,
      ).toBeGreaterThan(20);
    }
    // The Owner changes an Admin; an Admin changes a User.
    await expect(
      controller.set(ADMIN.id, body([], ['C']), as(OWNER)),
    ).resolves.toBeDefined();
    await expect(
      controller.set(USER.id, body([], ['A']), as(ADMIN)),
    ).resolves.toBeDefined();
  });

  it('an Admin reads the access of Users only; the Owner reads anybody’s', async () => {
    const { controller } = harness();
    for (const target of [OWNER, ADMIN, ADMIN2]) {
      const answer = await refused(controller.get(target.id, as(ADMIN)));
      expect(answer.status).toBe(403);
      expect(answer.body).toMatchObject({ code: 'ACCESS_NOT_EDITABLE' });
    }
    await expect(controller.get(USER.id, as(ADMIN))).resolves.toBeDefined();
    await expect(controller.get(ADMIN.id, as(OWNER))).resolves.toBeDefined();
    // The Owner's own row: every agent, whatever lists were left behind.
    expect((await controller.get(OWNER.id, as(OWNER))).outcome).toEqual({
      kind: 'all',
      count: 0,
    });
  });

  it('400 ACCESS_LISTS_OVERLAP: an agent in both arrays', async () => {
    const { controller } = harness();
    const answer = await refused(
      controller.set(USER.id, body(['A'], ['A']), as(OWNER)),
    );
    expect(answer.status).toBe(400);
    expect(answer.body).toMatchObject({ code: 'ACCESS_LISTS_OVERLAP' });
  });

  it('404 with no code: an unknown agent, an agent outside the view, an unknown user', async () => {
    const { controller, gateway } = harness();
    gateway.seed(ADMIN.id, true, [{ agentId: 'A', list: 'allowed' }]);
    const unknown = await refused(
      controller.set(USER.id, body(['nope'], []), as(OWNER)),
    );
    const outside = await refused(
      controller.set(USER.id, body([], ['C']), as(ADMIN)),
    );
    expect(unknown.status).toBe(404);
    expect(unknown.body).toMatchObject({ message: 'Agent not found' });
    expect(unknown.body).not.toHaveProperty('code');
    // Outside the view is the very same answer.
    expect(outside).toEqual(unknown);

    const noUser = await refused(controller.get('user-nobody', as(OWNER)));
    expect(noUser.status).toBe(404);
    expect(noUser.body).toMatchObject({ message: 'User not found' });
  });

  it('409 ACCESS_EXCEEDS_CEILING: an Admin opening what they do not have', async () => {
    const { controller, gateway } = harness();
    gateway.seed(ADMIN.id, true, [{ agentId: 'A', list: 'allowed' }]);
    gateway.seed(USER.id, true, [{ agentId: 'A', list: 'allowed' }]);
    const version = (await controller.get(USER.id, as(ADMIN))).version;
    const answer = await refused(
      controller.set(USER.id, body([], [], version, true), as(ADMIN)),
    );
    expect(answer.status).toBe(409);
    expect(answer.body).toEqual({
      code: 'ACCESS_EXCEEDS_CEILING',
      message: 'This would open agents you do not have. Ask the Owner.',
    });
  });

  it('409 ACCESS_OPEN_NEEDS_CONFIRM carries the outcome; confirmOpen saves it', async () => {
    const { controller, gateway } = harness();
    gateway.seed(USER.id, true, [{ agentId: 'A', list: 'allowed' }]);
    const version = (await controller.get(USER.id, as(OWNER))).version;
    const answer = await refused(
      controller.set(USER.id, body([], ['B'], version), as(OWNER)),
    );
    expect(answer.status).toBe(409);
    expect(answer.body).toMatchObject({
      code: 'ACCESS_OPEN_NEEDS_CONFIRM',
      outcome: { kind: 'all_except', count: 1 },
    });
    // Nothing was saved by the refusal.
    expect((await controller.get(USER.id, as(OWNER))).version).toBe(version);

    const saved = await controller.set(
      USER.id,
      body([], ['B'], version, true),
      as(OWNER),
    );
    expect(saved.outcome).toEqual({ kind: 'all_except', count: 1 });
  });

  it('409 ACCESS_CHANGED: the version is not the current one', async () => {
    const { controller } = harness();
    const first = await controller.set(USER.id, body([], ['A']), as(OWNER));
    const stale = await refused(
      controller.set(USER.id, body([], ['B'], null), as(OWNER)),
    );
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ code: 'ACCESS_CHANGED' });
    await expect(
      controller.set(USER.id, body([], ['B'], first.version), as(OWNER)),
    ).resolves.toMatchObject({ denied: ['B'] });
  });

  it('moving an agent between the lists leaves it on one', async () => {
    const { controller, gateway } = harness();
    const one = await controller.set(USER.id, body(['A', 'B'], []), as(OWNER));
    const two = await controller.set(
      USER.id,
      body(['B'], ['A'], one.version),
      as(OWNER),
    );
    expect(two.allowed).toEqual(['B']);
    expect(two.denied).toEqual(['A']);
    const three = await controller.set(
      USER.id,
      body(['B', 'A'], [], two.version),
      as(OWNER),
    );
    expect(three.allowed.sort()).toEqual(['A', 'B']);
    expect(three.denied).toEqual([]);
    const ids = (await gateway.load(USER.id)).entries.map((e) => e.agentId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('an agent runtime’s token edits nothing, whatever roles it carries', async () => {
    const { controller } = harness();
    const runtime = {
      user: { sub: 'agent:ranch', email: '', roles: [UserRoleTypes.Owner] },
    } as AuthedRequest;
    const answer = await refused(
      controller.set(USER.id, body([], ['A']), runtime),
    );
    expect(answer.status).toBe(403);
  });
});
