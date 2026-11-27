import 'reflect-metadata';
import {
  ArgumentMetadata,
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
  RequestMethod,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import {
  ADMIN,
  OWNER,
  accessHarness,
} from '#/user/agentAccess/domain/__fixtures__/agentAccess';
import type { IAccessCaller } from '#/user/agentAccess/domain/agentAccess.types';
import { IAuthTokenPayload } from '#/user/auth/domain/auth.types';
import {
  JwtAuthGuard,
  PUBLIC_METADATA_KEY,
  ROLES_METADATA_KEY,
  RolesGuard,
} from '#/user/auth/guards';
import { UserRoleTypes } from '#/user/user/domain';
import {
  IInstallationQuestion,
  IInstallationStats,
  InstallationStatsService,
} from './domain';
import { installationHarness } from './domain/__fixtures__/installationStats';
import { InstallationStatsQueryDto } from './dtos';
import { InstallationStatsController } from './installationStats.controller';

type AuthedRequest = Request & { user?: IAuthTokenPayload };

const req = (
  sub: string,
  roles: UserRoleTypes[],
  extra: Record<string, unknown> = {},
): AuthedRequest =>
  ({
    user: { sub, roles, email: '', ...extra } as IAuthTokenPayload,
  }) as AuthedRequest;

/** A service that records what it was asked and answers a marker. */
function recordingService() {
  const answer = {
    marker: 'the service’s answer',
  } as unknown as IInstallationStats;
  const forCaller = jest.fn(
    (_caller: IAccessCaller, _question: IInstallationQuestion) =>
      Promise.resolve(answer),
  );
  const controller = new InstallationStatsController({
    forCaller,
  } as unknown as InstallationStatsService);
  const asked = () => forCaller.mock.calls[forCaller.mock.calls.length - 1];
  return { controller, forCaller, answer, asked };
}

// The pipe as main.ts configures it.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: false,
});
const QUERY: ArgumentMetadata = {
  type: 'query',
  metatype: InstallationStatsQueryDto,
};
const parse = (query: Record<string, unknown>) =>
  pipe.transform(query, QUERY) as Promise<InstallationStatsQueryDto>;

describe('GET /stats/installation: who may call it', () => {
  const handler = Object.getOwnPropertyDescriptor(
    InstallationStatsController.prototype,
    'get',
  )?.value as (...args: unknown[]) => unknown;

  const contextFor = (request: unknown): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => InstallationStatsController,
      switchToHttp: () => ({ getRequest: () => request }),
    }) as unknown as ExecutionContext;

  const roles = new RolesGuard(new Reflector());
  /** The status the role guard answers this bearer with; 200 when it passes. */
  const statusFor = (user: unknown): number => {
    try {
      return roles.canActivate(contextFor({ user })) ? 200 : 403;
    } catch (e) {
      if (e instanceof ForbiddenException) return e.getStatus();
      throw e;
    }
  };
  const token = (role: UserRoleTypes, sub = 'user-x') => ({
    sub,
    email: '',
    roles: [role],
  });

  it('is GET stats/installation', () => {
    expect(
      Reflect.getMetadata(PATH_METADATA, InstallationStatsController),
    ).toBe('stats/installation');
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('/');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.GET,
    );
  });

  it('answers 401 without a token: the JWT guard stands in front and the route is not public', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      InstallationStatsController,
    ) as unknown[];
    // In this order: the role is read from what the first guard verified.
    expect(guards).toEqual([JwtAuthGuard, RolesGuard]);

    const reflector = new Reflector();
    expect(
      reflector.getAllAndOverride(PUBLIC_METADATA_KEY, [
        handler,
        InstallationStatsController,
      ]),
    ).toBeUndefined();

    const guard = new JwtAuthGuard(
      { verify: () => ({}), decode: () => null } as unknown as JwtService,
      reflector,
    );
    const anonymous = {
      headers: {},
      method: 'GET',
      url: '/stats/installation',
    };
    let thrown: unknown;
    try {
      guard.canActivate(contextFor(anonymous));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(UnauthorizedException);
    expect((thrown as UnauthorizedException).getStatus()).toBe(401);
  });

  it('states its roles: the Owner and Admins', () => {
    expect(
      Reflect.getMetadata(ROLES_METADATA_KEY, InstallationStatsController),
    ).toEqual([UserRoleTypes.Owner, UserRoleTypes.Admin]);
  });

  it('answers 403 for a User', () => {
    expect(statusFor(token(UserRoleTypes.User))).toBe(403);
  });

  it('lets an Admin and the Owner through', () => {
    expect(statusFor(token(UserRoleTypes.Admin))).toBe(200);
    expect(statusFor(token(UserRoleTypes.Owner))).toBe(200);
  });

  it('answers 403 for a token with no role, and for an agent runtime’s own token whatever it carries', () => {
    expect(statusFor({ sub: 'user-x', email: '', roles: [] })).toBe(403);
    // The Ranch admin agent's token carries Owner. Over REST it is an agent
    // and nothing else: its way to these figures is the tool, where the
    // party it answers for is checked.
    expect(statusFor(token(UserRoleTypes.Owner, 'agent:ranch'))).toBe(403);
    expect(statusFor(token(UserRoleTypes.Agent, 'agent:helper'))).toBe(403);
  });
});

describe('GET /stats/installation: whose reach', () => {
  it('asks as the Admin the token names, and answers what the service answered', async () => {
    const { controller, asked, answer } = recordingService();

    const res = await controller.get({}, req('admin-7', [UserRoleTypes.Admin]));

    expect(asked()).toEqual([
      { kind: 'person', userId: 'admin-7', role: UserRoleTypes.Admin },
      { period: 30 },
    ]);
    expect(res).toBe(answer);
  });

  it('asks as the Owner the token names', async () => {
    const { controller, asked } = recordingService();

    await controller.get({}, req('owner-1', [UserRoleTypes.Owner]));

    expect(asked()[0]).toEqual({
      kind: 'person',
      userId: 'owner-1',
      role: UserRoleTypes.Owner,
    });
  });

  it('lets no query parameter say whose reach or which agents: the pipe drops what is not `period`', async () => {
    const parsed = await parse({
      period: '7',
      tz: 'Europe/Kyiv',
      userId: 'owner-1',
      role: 'Owner',
      agentId: 'agent-3',
      agentIds: ['agent-3'],
      scope: 'all',
    });

    expect({ ...parsed }).toEqual({ period: 7 });
  });

  it('and a parameter that reached the handler anyway changes nothing: the reach is the token’s', async () => {
    const { controller, asked } = recordingService();
    const smuggled = {
      period: 7,
      userId: 'owner-1',
      role: 'Owner',
      agentId: 'agent-3',
    } as unknown as InstallationStatsQueryDto;

    await controller.get(smuggled, req('admin-7', [UserRoleTypes.Admin]));

    expect(asked()).toEqual([
      { kind: 'person', userId: 'admin-7', role: UserRoleTypes.Admin },
      { period: 7 },
    ]);
  });

  // The whole way: the real service, the real access lists. An Admin limited
  // to one agent of two is shown that agent's figures and nothing else.
  it('shows a limited Admin only the agents they reach, and the Owner all of them', async () => {
    const { service: access, gateway: lists } = accessHarness(['a1', 'a2']);
    lists.seed(ADMIN.id, true, [{ agentId: 'a1', list: 'allowed' }]);
    const today = new Date().toISOString().slice(0, 10);
    const { service } = installationHarness(
      {
        agents: [
          { id: 'a1', name: 'Atlas' },
          { id: 'a2', name: 'Beacon' },
        ],
        usage: [
          {
            agentId: 'a1',
            day: today,
            model: 'claude-sonnet-4-6',
            input: 100,
            output: 10,
            calls: 4,
          },
          {
            agentId: 'a2',
            day: today,
            model: 'claude-sonnet-4-6',
            input: 900,
            output: 90,
            calls: 36,
          },
        ],
      },
      access,
    );
    const controller = new InstallationStatsController(service);

    const mine = await controller.get({}, req(ADMIN.id, [ADMIN.role]));
    const whole = await controller.get({}, req(OWNER.id, [OWNER.role]));

    expect(mine.reach).toEqual({ limited: true, agents: 1, ownerOnly: [] });
    expect(mine.board.calls.value).toBe(4);
    expect(mine.agents.map((a) => a.name)).toEqual(['Atlas']);
    expect(whole.reach).toEqual({
      limited: false,
      agents: 2,
      ownerOnly: [],
    });
    expect(whole.board.calls.value).toBe(40);
    expect(whole.agents.map((a) => a.name)).toEqual(['Beacon', 'Atlas']);
  });
});

describe('GET /stats/installation: the period', () => {
  const messagesOf = async (query: Record<string, unknown>) => {
    try {
      await parse(query);
      return [];
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      expect((e as BadRequestException).getStatus()).toBe(400);
      return ((e as BadRequestException).getResponse() as { message: string[] })
        .message;
    }
  };

  it('takes 7, 30 and 90, as the query string writes them', async () => {
    for (const period of ['7', '30', '90']) {
      expect((await parse({ period })).period).toBe(Number(period));
    }
  });

  it('answers 400 for any other period', async () => {
    for (const period of [
      '1',
      '14',
      '31',
      '180',
      '365',
      '0',
      '-7',
      '7.5',
      'week',
      '',
    ]) {
      const messages = await messagesOf({ period });
      expect([period, messages.join(' ')]).toEqual([
        period,
        expect.stringContaining('period'),
      ]);
    }
    // A repeated key arrives as a list: not one of the three either.
    expect((await messagesOf({ period: ['7', '30'] })).join(' ')).toContain(
      'period',
    );
  });

  it('asks for 30 days when no period is given', async () => {
    const { controller, asked } = recordingService();

    await controller.get(
      await parse({}),
      req('admin-7', [UserRoleTypes.Admin]),
    );

    expect(asked()[1]).toEqual({ period: 30 });
  });

  it('hands the period on as it was asked', async () => {
    const { controller, asked } = recordingService();

    for (const period of ['7', '90']) {
      await controller.get(
        await parse({ period }),
        req('admin-7', [UserRoleTypes.Admin]),
      );
      expect(asked()[1]).toEqual({ period: Number(period) });
    }
  });
});
