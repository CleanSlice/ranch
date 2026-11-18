import 'reflect-metadata';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import type { Request } from 'express';
import type { IAuthTokenPayload } from '#/user/auth/domain/auth.types';
import { ROLES_METADATA_KEY } from '#/user/auth/guards';
import { UserRoleTypes } from '#/user/user/domain';
import { AGENT_SCOPED_METADATA_KEY } from '#/user/agentAccess/guards';
import { AgentPinController } from './agentPin.controller';
import { IAgentPinGateway } from './domain/agentPin.gateway';

/**
 * `PUT` / `DELETE /agents/:id/pin` (CLEAN-231): a pin is the caller's own.
 * Reach is the guard's (`@AgentScoped('id')`, agentAccess.guard.spec.ts);
 * here: whose pin it is, that both calls are idempotent, and who is refused.
 */

type AuthedRequest = Request & { user?: IAuthTokenPayload };

const as = (sub: string, role: UserRoleTypes, extra = {}): AuthedRequest =>
  ({ user: { sub, email: '', roles: [role], ...extra } }) as AuthedRequest;

/** Pins in memory; `agent-a` and `agent-b` exist. */
class MemoryPins extends IAgentPinGateway {
  private agents = new Set(['agent-a', 'agent-b']);
  private rows = new Set<string>();

  pin(userId: string, agentId: string): Promise<boolean> {
    if (!this.agents.has(agentId)) return Promise.resolve(false);
    this.rows.add(`${userId}|${agentId}`);
    return Promise.resolve(true);
  }

  unpin(userId: string, agentId: string): Promise<boolean> {
    this.rows.delete(`${userId}|${agentId}`);
    return Promise.resolve(this.agents.has(agentId));
  }

  pinnedIds(userId: string): Promise<Set<string>> {
    return Promise.resolve(
      new Set(
        [...this.rows]
          .filter((row) => row.startsWith(`${userId}|`))
          .map((row) => row.split('|')[1]),
      ),
    );
  }

  removeUser(userId: string): Promise<void> {
    for (const row of this.rows) {
      if (row.startsWith(`${userId}|`)) this.rows.delete(row);
    }
    return Promise.resolve();
  }
}

function harness() {
  const pins = new MemoryPins();
  return { pins, controller: new AgentPinController(pins) };
}

describe('AgentPinController', () => {
  it('is open to every signed-in person and scoped to an agent they reach', () => {
    expect(Reflect.getMetadata(ROLES_METADATA_KEY, AgentPinController)).toEqual(
      [UserRoleTypes.User],
    );
    expect(
      Reflect.getMetadata(AGENT_SCOPED_METADATA_KEY, AgentPinController),
    ).toEqual({ source: 'id' });
  });

  it('answers 204 on both routes', () => {
    for (const handler of ['pin', 'unpin'] as const) {
      expect(
        Reflect.getMetadata(
          HTTP_CODE_METADATA,
          AgentPinController.prototype[handler],
        ),
      ).toBe(204);
    }
  });

  it('a User pins for themselves, and nobody else’s pins change', async () => {
    const { controller, pins } = harness();
    await controller.pin('agent-a', as('user-1', UserRoleTypes.User));
    expect([...(await pins.pinnedIds('user-1'))]).toEqual(['agent-a']);
    expect([...(await pins.pinnedIds('user-2'))]).toEqual([]);

    // The Owner pins the same agent: an independent pin.
    await controller.pin('agent-a', as('user-o', UserRoleTypes.Owner));
    await controller.unpin('agent-a', as('user-1', UserRoleTypes.User));
    expect([...(await pins.pinnedIds('user-1'))]).toEqual([]);
    expect([...(await pins.pinnedIds('user-o'))]).toEqual(['agent-a']);
  });

  it('pinning twice and unpinning what was never pinned are not errors', async () => {
    const { controller, pins } = harness();
    const user = as('user-1', UserRoleTypes.User);
    await expect(controller.pin('agent-a', user)).resolves.toBeUndefined();
    await expect(controller.pin('agent-a', user)).resolves.toBeUndefined();
    expect([...(await pins.pinnedIds('user-1'))]).toEqual(['agent-a']);
    await expect(controller.unpin('agent-b', user)).resolves.toBeUndefined();
    await expect(controller.unpin('agent-a', user)).resolves.toBeUndefined();
    await expect(controller.unpin('agent-a', user)).resolves.toBeUndefined();
  });

  it('an agent that does not exist is 404 on both routes', async () => {
    const { controller } = harness();
    const user = as('user-1', UserRoleTypes.User);
    await expect(controller.pin('nope', user)).rejects.toThrow(
      new NotFoundException('Agent not found'),
    );
    await expect(controller.unpin('nope', user)).rejects.toThrow(
      new NotFoundException('Agent not found'),
    );
  });

  it('a caller that is not a person is refused 403 and pins nothing', async () => {
    const { controller, pins } = harness();
    const spy = jest.spyOn(pins, 'pin');
    for (const caller of [
      // An agent runtime, whatever roles its token carries.
      as('agent:agent-a', UserRoleTypes.Agent),
      as('agent:ranch', UserRoleTypes.Owner),
      // An embed token.
      as('visitor-1', UserRoleTypes.User, { typ: 'embed' }),
      {} as AuthedRequest,
    ]) {
      await expect(controller.pin('agent-a', caller)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(controller.unpin('agent-a', caller)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    }
    expect(spy).not.toHaveBeenCalled();
  });
});
