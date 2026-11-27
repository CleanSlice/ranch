import 'reflect-metadata';
import {
  ArgumentMetadata,
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { IAuthTokenPayload } from '#/user/auth/domain/auth.types';
import {
  JwtAuthGuard,
  PUBLIC_METADATA_KEY,
  ROLES_METADATA_KEY,
  RolesGuard,
} from '#/user/auth/guards';
import { UserRoleTypes } from '#/user/user/domain';
import { IPersonalStats, IStatsQuestion, IStatsViewer } from './domain';
import { PersonalStatsService } from './domain';
import { statsHarness } from './domain/__fixtures__/personalStats';
import { MyStatsQueryDto } from './dtos';
import { MyStatsController } from './myStats.controller';

type AuthedRequest = Request & { user?: IAuthTokenPayload };

const req = (
  sub?: string,
  roles: UserRoleTypes[] = [UserRoleTypes.User],
  extra: Record<string, unknown> = {},
): AuthedRequest =>
  ({
    user: sub
      ? ({ sub, roles, email: '', ...extra } as IAuthTokenPayload)
      : undefined,
  }) as AuthedRequest;

/** A service that records what it was asked and answers a marker. */
function recordingService() {
  const answer = {
    marker: 'the service’s answer',
  } as unknown as IPersonalStats;
  const forPerson = jest.fn(
    (_viewer: IStatsViewer, _question: IStatsQuestion) =>
      Promise.resolve(answer),
  );
  const controller = new MyStatsController({
    forPerson,
  } as unknown as PersonalStatsService);
  const asked = () => forPerson.mock.calls[forPerson.mock.calls.length - 1];
  return { controller, forPerson, answer, asked };
}

// The pipe as main.ts configures it.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: false,
});
const QUERY: ArgumentMetadata = { type: 'query', metatype: MyStatsQueryDto };
const parse = (query: Record<string, unknown>) =>
  pipe.transform(query, QUERY) as Promise<MyStatsQueryDto>;

describe('GET /me/stats: who may call it', () => {
  const handler = Object.getOwnPropertyDescriptor(
    MyStatsController.prototype,
    'get',
  )?.value as (...args: unknown[]) => unknown;

  const contextFor = (request: unknown): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => MyStatsController,
      switchToHttp: () => ({ getRequest: () => request }),
    }) as unknown as ExecutionContext;

  it('is GET me/stats', () => {
    expect(Reflect.getMetadata(PATH_METADATA, MyStatsController)).toBe(
      'me/stats',
    );
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('/');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.GET,
    );
  });

  it('answers 401 without a token: the JWT guard stands in front and the route is not public', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      MyStatsController,
    ) as unknown[];
    expect(guards).toContain(JwtAuthGuard);

    const reflector = new Reflector();
    expect(
      reflector.getAllAndOverride(PUBLIC_METADATA_KEY, [
        handler,
        MyStatsController,
      ]),
    ).toBeUndefined();

    const guard = new JwtAuthGuard(
      { verify: () => ({}), decode: () => null } as unknown as JwtService,
      reflector,
    );
    const anonymous = { headers: {}, method: 'GET', url: '/me/stats' };
    let thrown: unknown;
    try {
      guard.canActivate(contextFor(anonymous));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(UnauthorizedException);
    expect((thrown as UnauthorizedException).getStatus()).toBe(401);
  });

  it('states its role: every signed-in account, which a route with no role would not admit', () => {
    expect(Reflect.getMetadata(ROLES_METADATA_KEY, MyStatsController)).toEqual([
      UserRoleTypes.User,
    ]);

    const roles = new RolesGuard(new Reflector());
    const passes = (user: unknown) => {
      try {
        return roles.canActivate(contextFor({ user }));
      } catch (e) {
        if (e instanceof ForbiddenException) return false;
        throw e;
      }
    };
    const token = (role: UserRoleTypes, sub = 'user-x') => ({
      sub,
      email: '',
      roles: [role],
    });
    expect(passes(token(UserRoleTypes.User))).toBe(true);
    expect(passes(token(UserRoleTypes.Admin))).toBe(true);
    expect(passes(token(UserRoleTypes.Owner))).toBe(true);
    // A valid token that holds no role, and an agent runtime's own token.
    expect(passes({ sub: 'user-x', email: '', roles: [] })).toBe(false);
    expect(passes(token(UserRoleTypes.Owner, 'agent:ranch'))).toBe(false);
  });
});

describe('GET /me/stats: whose statistics', () => {
  it('asks for a User’s own: their account, and their account as the chat identity', async () => {
    const { controller, asked, answer } = recordingService();

    const res = await controller.get({}, req('user-1', [UserRoleTypes.User]));

    expect(asked()[0]).toEqual({
      userId: 'user-1',
      clientId: 'user-1',
      caller: { kind: 'person', userId: 'user-1', role: UserRoleTypes.User },
    });
    expect(res).toBe(answer);
  });

  it('asks for an Admin’s own in the same way: an Admin is their own chat identity', async () => {
    const { controller, asked } = recordingService();

    await controller.get({}, req('admin-7', [UserRoleTypes.Admin]));

    expect(asked()[0]).toEqual({
      userId: 'admin-7',
      clientId: 'admin-7',
      caller: { kind: 'person', userId: 'admin-7', role: UserRoleTypes.Admin },
    });
  });

  it('asks for the Owner’s own: conversations under `admin`, ratings under their account', async () => {
    const { controller, asked } = recordingService();

    await controller.get({}, req('owner-1', [UserRoleTypes.Owner]));

    expect(asked()[0]).toEqual({
      userId: 'owner-1',
      clientId: 'admin',
      caller: { kind: 'person', userId: 'owner-1', role: UserRoleTypes.Owner },
    });
  });

  it('refuses a request that carries no person', async () => {
    const { controller, forPerson } = recordingService();

    await expect(controller.get({}, req(undefined))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(forPerson).not.toHaveBeenCalled();
  });

  // A `sub` that is one of the chat identities the hub keeps for itself
  // proves no identity (`clientIdFromJwtPayload` answers null). Falling back
  // to the bare `sub` would read the Owner's conversations for it.
  it('refuses a token whose subject is a reserved chat identity, and does not read `admin` for it', async () => {
    const { controller, forPerson } = recordingService();

    for (const sub of ['admin', 'cron', 'heartbeat', 'peer:c1:x']) {
      await expect(
        controller.get({}, req(sub, [UserRoleTypes.User])),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(forPerson).not.toHaveBeenCalled();
  });

  it('lets no query parameter say whose figures: the pipe drops what is not `period` or `tz`', async () => {
    const parsed = await parse({
      period: '7',
      tz: 'Europe/Kyiv',
      userId: 'user-2',
      clientId: 'admin',
      externalUserId: 'admin',
      authorId: 'user-2',
      sub: 'user-2',
      agentId: 'agent-1',
    });

    expect({ ...parsed }).toEqual({ period: 7, tz: 'Europe/Kyiv' });
  });

  it('and a parameter that reached the handler anyway changes nothing: the person is the token’s', async () => {
    const { controller, asked } = recordingService();
    const smuggled = {
      period: 7,
      userId: 'user-2',
      clientId: 'admin',
      externalUserId: 'admin',
    } as unknown as MyStatsQueryDto;

    await controller.get(smuggled, req('user-1', [UserRoleTypes.User]));

    expect(asked()).toEqual([
      {
        userId: 'user-1',
        clientId: 'user-1',
        caller: { kind: 'person', userId: 'user-1', role: UserRoleTypes.User },
      },
      { period: 7, timeZone: undefined },
    ]);
  });
});

describe('GET /me/stats: the period and the zone', () => {
  const messagesOf = async (query: Record<string, unknown>) => {
    try {
      await parse(query);
      return [];
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
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

    await controller.get(await parse({}), req('user-1'));

    expect(asked()[1]).toEqual({ period: 30, timeZone: undefined });
  });

  it('hands the period and the zone on as they were asked', async () => {
    const { controller, asked } = recordingService();

    await controller.get(
      await parse({ period: '90', tz: 'America/Los_Angeles' }),
      req('user-1'),
    );

    expect(asked()[1]).toEqual({
      period: 90,
      timeZone: 'America/Los_Angeles',
    });
  });

  it('never refuses a zone: whatever `tz` holds passes validation', async () => {
    for (const tz of ['Mars/Olympus', '', '+03:00', 'x'.repeat(500)]) {
      expect((await parse({ tz })).tz).toBe(tz);
    }
    expect((await parse({ tz: ['UTC', 'Europe/Kyiv'] })).tz).toEqual([
      'UTC',
      'Europe/Kyiv',
    ]);
  });

  it('answers in UTC for a zone it does not know, and says so', async () => {
    const { service } = statsHarness();
    const controller = new MyStatsController(service);

    const unknown = await controller.get(
      await parse({ tz: 'Mars/Olympus' }),
      req('user-1'),
    );
    const known = await controller.get(
      await parse({ tz: 'Europe/Kyiv' }),
      req('user-1'),
    );

    expect(unknown.timeZone).toBe('UTC');
    expect(unknown.period).toBe(30);
    expect(known.timeZone).toBe('Europe/Kyiv');
  });
});
