import { Reflector } from '@nestjs/core';
import { AgentLimitController } from './agentLimit.controller';
import { AgentLimitService, IAgentLimitGateway, IAgentLimits } from './domain';
import { ROLES_METADATA_KEY } from '#/user/auth/guards/roles.decorator';
import { UserRoleTypes } from '#/user/user/domain';

const limits = (l: Partial<IAgentLimits>): IAgentLimits => ({
  perMinute: null,
  perHour: null,
  perDay: null,
  ...l,
});

function make(agents: Array<{ id: string; isPublic: boolean }>) {
  const saved: Array<{
    agentId: string;
    limits: IAgentLimits;
    userId: string | null;
  }> = [];
  const store: IAgentLimitGateway = {
    findAll: () => Promise.resolve([]),
    upsert: (agentId, l, userId) => {
      saved.push({ agentId, limits: l, userId });
      return Promise.resolve();
    },
    remove: () => Promise.resolve(),
    addMinutes: () => Promise.resolve(),
    minutes: () => Promise.resolve([]),
    pruneBefore: () => Promise.resolve(),
  };
  const service = new AgentLimitService(store);
  const agentGateway = {
    findAll: () => Promise.resolve(agents),
    findById: (id: string) =>
      Promise.resolve(agents.find((a) => a.id === id) ?? null),
  };
  const controller = new AgentLimitController(service, agentGateway as never);
  return { controller, service, saved };
}

const asOwner = { user: { sub: 'owner-1', roles: ['Owner'] } } as never;

const codeOf = async (run: Promise<unknown>): Promise<unknown> => {
  try {
    await run;
    return null;
  } catch (err) {
    const body = (err as { getResponse?: () => unknown }).getResponse?.();
    return (body as { code?: string } | undefined)?.code ?? 'OTHER';
  }
};

describe('AgentLimitController', () => {
  describe('who may call what', () => {
    const reflector = new Reflector();
    const rolesOf = (method: 'list' | 'get' | 'set' | 'load' | 'enabled') =>
      reflector.get<UserRoleTypes[]>(
        ROLES_METADATA_KEY,
        AgentLimitController.prototype[method],
      );

    it('keeps limit values and load figures to Owner and Admin', () => {
      for (const method of ['list', 'get', 'set', 'load'] as const) {
        expect(rolesOf(method)).toEqual([
          UserRoleTypes.Owner,
          UserRoleTypes.Admin,
        ]);
      }
    });

    it('lets any signed-in user ask only whether limits are on', () => {
      expect(rolesOf('enabled')).toEqual([UserRoleTypes.User]);
    });
  });

  it('reads limits as null while they are off', async () => {
    const { controller } = make([{ id: 'a', isPublic: false }]);
    expect(await controller.get('a')).toEqual({ limits: null });
  });

  it('saves limits with who changed them, and reads them back', async () => {
    const { controller, saved } = make([{ id: 'a', isPublic: false }]);
    const wanted = limits({ perMinute: 5, perDay: 100 });

    expect(
      await controller.set('a', { perMinute: 5, perDay: 100 }, asOwner),
    ).toEqual({ limits: wanted });
    expect(saved).toEqual([
      { agentId: 'a', limits: wanted, userId: 'owner-1' },
    ]);
    expect(await controller.get('a')).toEqual({ limits: wanted });
  });

  it('switches limits off when every window is empty', async () => {
    const { controller } = make([{ id: 'a', isPublic: false }]);
    await controller.set('a', { perMinute: 5 }, asOwner);

    expect(
      await controller.set(
        'a',
        { perMinute: null, perHour: null, perDay: null },
        asOwner,
      ),
    ).toEqual({ limits: null });
    expect(await controller.enabled('a')).toEqual({ enabled: false });
  });

  it('refuses to remove the last limit from a public agent', async () => {
    const { controller, service } = make([{ id: 'p', isPublic: true }]);
    await service.setLimits('p', limits({ perMinute: 5 }), null);

    expect(await codeOf(controller.set('p', {}, asOwner))).toBe(
      'PUBLIC_AGENT_NEEDS_LIMITS',
    );
    expect(await controller.get('p')).toEqual({
      limits: limits({ perMinute: 5 }),
    });
  });

  it('refuses an empty save for a public agent that never had limits', async () => {
    const { controller } = make([{ id: 'legacy', isPublic: true }]);
    expect(await codeOf(controller.set('legacy', {}, asOwner))).toBe(
      'PUBLIC_AGENT_NEEDS_LIMITS',
    );
  });

  it('answers with a code for a value out of range and for windows that contradict', async () => {
    const { controller } = make([{ id: 'a', isPublic: false }]);
    expect(await codeOf(controller.set('a', { perMinute: 0 }, asOwner))).toBe(
      'LIMIT_OUT_OF_RANGE',
    );
    expect(await codeOf(controller.set('a', { perMinute: 2.5 }, asOwner))).toBe(
      'LIMIT_OUT_OF_RANGE',
    );
    expect(
      await codeOf(controller.set('a', { perMinute: 10, perHour: 5 }, asOwner)),
    ).toBe('LIMIT_WINDOWS_CONTRADICT');
  });

  it('answers 400 for those refusals', async () => {
    const { controller } = make([{ id: 'a', isPublic: false }]);
    await expect(
      controller.set('a', { perMinute: 0 }, asOwner),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('answers 404 for an agent that does not exist, on every route', async () => {
    const { controller } = make([]);
    await expect(controller.get('nope')).rejects.toMatchObject({ status: 404 });
    await expect(
      controller.set('nope', { perMinute: 1 }, asOwner),
    ).rejects.toMatchObject({ status: 404 });
    await expect(controller.enabled('nope')).rejects.toMatchObject({
      status: 404,
    });
    await expect(controller.load('nope')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('tells any signed-in user one boolean and nothing else', async () => {
    const { controller } = make([{ id: 'a', isPublic: false }]);
    await controller.set('a', { perMinute: 5 }, asOwner);
    expect(await controller.enabled('a')).toEqual({ enabled: true });
  });

  it('summarises every agent for the list', async () => {
    const { controller, service } = make([
      { id: 'full', isPublic: true },
      { id: 'legacy', isPublic: true },
      { id: 'plain', isPublic: false },
    ]);
    await service.setLimits('full', limits({ perMinute: 1 }), null);
    service.check('full', 'visitor');

    expect(await controller.list()).toEqual([
      { agentId: 'full', enabled: true, atLimit: true, needsLimits: false },
      { agentId: 'legacy', enabled: false, atLimit: false, needsLimits: true },
      { agentId: 'plain', enabled: false, atLimit: false, needsLimits: false },
    ]);
  });

  it('returns the live picture of one agent', async () => {
    const { controller, service } = make([{ id: 'a', isPublic: true }]);
    await service.setLimits('a', limits({ perMinute: 2 }), null);
    service.check('a', 'visitor');
    service.check('a', 'visitor');
    service.check('a', 'visitor');
    service.check('a', 'operator');

    const load = await controller.load('a');

    expect(load.limits).toEqual(limits({ perMinute: 2 }));
    expect(load.isPublic).toBe(true);
    expect(load.needsLimits).toBe(false);
    expect(load.windows[0]).toEqual({
      window: 'minute',
      used: 2,
      limit: 2,
      retryAfterSec: expect.any(Number),
    });
    expect(load.series).toHaveLength(60);
    const total = load.series.reduce(
      (sum, m) => ({
        accepted: sum.accepted + m.accepted,
        refused: sum.refused + m.refused,
        exempt: sum.exempt + m.exempt,
      }),
      { accepted: 0, refused: 0, exempt: 0 },
    );
    expect(total).toEqual({ accepted: 2, refused: 1, exempt: 1 });
    expect(Object.keys(load.series[59]).sort()).toEqual([
      'accepted',
      'exempt',
      'minute',
      'refused',
    ]);
    expect(new Date(load.series[59].minute).getUTCSeconds()).toBe(0);
    expect(load.refused.lastHour).toBe(1);
    expect(load.refused.byWindow).toEqual({ minute: 1, hour: 0, day: 0 });
    expect(load.exemptLastHour).toBe(1);
    expect(load.peaks).toEqual({ minute: 2, hour: 2, day: 2 });
    expect(load.apiReplicas).toBe(1);
  });

  it('puts nothing about any sender on the wire', async () => {
    const { controller, service } = make([{ id: 'a', isPublic: true }]);
    await service.setLimits('a', limits({ perMinute: 2 }), null);
    service.check('a', 'visitor');

    const wire = JSON.stringify(await controller.load('a'));
    for (const word of [
      'clientId',
      'userId',
      'email',
      'ip',
      'origin',
      'text',
    ]) {
      expect(wire).not.toContain(`"${word}"`);
    }
  });
});
