import {
  ArgumentMetadata,
  BadRequestException,
  ConflictException,
  ExecutionContext,
  ForbiddenException,
  HttpStatus,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import {
  ApiKeyGuard,
  JwtAuthGuard,
  ROLES_METADATA_KEY,
  RolesGuard,
  SCOPES_METADATA_KEY,
  ScopesGuard,
} from '#/user/auth/guards';
import { ApiKeyService } from '#/user/apiKey/domain/apiKey.service';
import {
  ApiKeyScopeTypes,
  IApiKeyData,
} from '#/user/apiKey/domain/apiKey.types';
import { UserRoleTypes } from '#/user/user/domain';
import { AgentEventController } from './agentEvent.controller';
import { AgentEventIngestController } from './agentEvent.ingest.controller';
import {
  AgentEventService,
  IAgentEventGateway,
  INotificationDestination,
  INotifier,
  NotificationDestinationService,
  TooManyEventsException,
} from './domain';
import { PostAgentEventDto } from './dtos';

const ADDRESS = 'https://hooks.slack.com/services/T000/B000/SECRETSECRET';

const key = (scopes: ApiKeyScopeTypes[]): IApiKeyData => ({
  id: 'key-1',
  name: 'cluster-watcher',
  prefix: 'abcd',
  scopes,
  lastUsedAt: null,
  expiresAt: null,
  createdBy: 'user-1',
  createdAt: new Date('2026-10-06T00:00:00Z'),
});

function contextFor(
  handler: (...args: never[]) => unknown,
  controller: new (...args: never[]) => unknown,
  request: Partial<Request> & { apiKey?: IApiKeyData; user?: unknown },
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('POST /agent-events — who may call it', () => {
  const post = AgentEventIngestController.prototype.post;

  it('is guarded by an API key and the events:write scope, never by a console session', () => {
    const guards = Reflect.getMetadata('__guards__', post) as unknown[];

    expect(guards).toEqual([ApiKeyGuard, ScopesGuard]);
    expect(Reflect.getMetadata(SCOPES_METADATA_KEY, post)).toEqual([
      ApiKeyScopeTypes.EventsWrite,
    ]);
  });

  describe('through the real guards', () => {
    const verify = jest.fn();
    const apiKeys = new ApiKeyService({} as never);
    apiKeys.verify = verify;
    const apiKeyGuard = new ApiKeyGuard(apiKeys);
    const scopesGuard = new ScopesGuard(new Reflector(), apiKeys);

    const attempt = async (authorization: string | undefined, found: IApiKeyData | null) => {
      verify.mockResolvedValue(found);
      const request = { headers: { authorization } } as Partial<Request>;
      const context = contextFor(post as never, AgentEventIngestController as never, request);
      await apiKeyGuard.canActivate(context);
      return scopesGuard.canActivate(context);
    };

    it('refuses a request with no key', async () => {
      await expect(attempt(undefined, null)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('refuses a wrong or revoked key', async () => {
      await expect(attempt('Bearer rk_nope', null)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('refuses a key that has other scopes but not this one', async () => {
      await expect(
        attempt('Bearer rk_x', key([ApiKeyScopeTypes.EmbedMint])),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets a key with events:write through', async () => {
      expect(await attempt('Bearer rk_x', key([ApiKeyScopeTypes.EventsWrite]))).toBe(true);
    });

    it('lets the admin wildcard through, as everywhere', async () => {
      expect(await attempt('Bearer rk_x', key([ApiKeyScopeTypes.Admin]))).toBe(true);
    });

    it('gives an events:write key nothing on a route that asks for another scope', () => {
      // The embed-token route's requirement, checked the way ScopesGuard does.
      expect(
        apiKeys.hasScope(key([ApiKeyScopeTypes.EventsWrite]), ApiKeyScopeTypes.EmbedMint),
      ).toBe(false);
    });
  });
});

describe('POST /agent-events — what it accepts', () => {
  // The pipe as main.ts configures it.
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: false,
  });
  const meta: ArgumentMetadata = { type: 'body', metatype: PostAgentEventDto };
  const messagesOf = async (body: unknown): Promise<string[]> => {
    try {
      await pipe.transform(body, meta);
      return [];
    } catch (e) {
      return ((e as BadRequestException).getResponse() as { message: string[] }).message;
    }
  };

  it('takes the two required fields alone', async () => {
    expect(await messagesOf({ agentId: 'a1', status: 'failed' })).toEqual([]);
  });

  it('names the field that is missing', async () => {
    expect((await messagesOf({ status: 'failed' })).join(' ')).toContain('agentId');
    expect((await messagesOf({ agentId: 'a1' })).join(' ')).toContain('status');
  });

  it('refuses an unknown status and lists the ones it takes', async () => {
    expect(await messagesOf({ agentId: 'a1', status: 'exploded' })).toEqual([
      'status must be one of the following values: failed, recovered',
    ]);
  });

  it('does not take unreachable from outside — that is Ranch’s own word', async () => {
    expect(await messagesOf({ agentId: 'a1', status: 'unreachable' })).toHaveLength(1);
  });

  it('refuses a datetime that is not ISO 8601, and a cause that is too long', async () => {
    expect(
      (await messagesOf({ agentId: 'a1', status: 'failed', datetime: 'yesterday' })).join(' '),
    ).toContain('datetime');
    expect(
      (await messagesOf({ agentId: 'a1', status: 'failed', reason: 'x'.repeat(2001) })).join(' '),
    ).toContain('reason');
  });

  it('drops fields it does not know instead of refusing the event', async () => {
    const dto = await pipe.transform(
      { agentId: 'a1', status: 'failed', cluster: 'prod' },
      meta,
    );

    expect(dto).toEqual({ agentId: 'a1', status: 'failed' });
  });
});

describe('POST /agent-events — the answer', () => {
  const event = { id: 'evt-1', outcome: 'opened', incidentId: 'inc-1' };
  const response = () =>
    ({ status: jest.fn(), setHeader: jest.fn() }) as unknown as Response & {
      status: jest.Mock;
      setHeader: jest.Mock;
    };
  const request = {
    apiKey: key([ApiKeyScopeTypes.EventsWrite]),
  } as Request & { apiKey: IApiKeyData };
  const body = { agentId: 'a1', status: 'failed' } as PostAgentEventDto;

  it('answers a new event with its id, what it did and its incident (201 by default)', async () => {
    const service = { acceptExternal: jest.fn(async () => ({ event, duplicate: false })) };
    const controller = new AgentEventIngestController(service as unknown as AgentEventService);
    const res = response();

    const answer = await controller.post(request, body, res);

    expect(answer).toEqual({ id: 'evt-1', outcome: 'opened', incidentId: 'inc-1', duplicate: false });
    expect(res.status).not.toHaveBeenCalled();
    expect(service.acceptExternal).toHaveBeenCalledWith(request.apiKey, body);
  });

  it('answers a retry of an event it already holds with 200 and the first id', async () => {
    const service = { acceptExternal: jest.fn(async () => ({ event, duplicate: true })) };
    const controller = new AgentEventIngestController(service as unknown as AgentEventService);
    const res = response();

    const answer = await controller.post(request, body, res);

    expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
    expect(answer.duplicate).toBe(true);
    expect(answer.id).toBe('evt-1');
  });

  it('tells a flooding sender how long to wait', async () => {
    const service = {
      acceptExternal: jest.fn(async () => {
        throw new TooManyEventsException(40);
      }),
    };
    const controller = new AgentEventIngestController(service as unknown as AgentEventService);
    const res = response();

    await expect(controller.post(request, body, res)).rejects.toMatchObject({ status: 429 });
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '40');
  });
});

describe('console routes — who may call them', () => {
  const rolesOf = (handler: unknown) =>
    Reflect.getMetadata(ROLES_METADATA_KEY, handler as object) as UserRoleTypes[] | undefined;
  const proto = AgentEventController.prototype;

  it('sits behind a console session and a role', () => {
    expect(Reflect.getMetadata('__guards__', AgentEventController)).toEqual([
      JwtAuthGuard,
      RolesGuard,
    ]);
  });

  it('lets owners and admins read, and nobody below them', () => {
    const guard = new RolesGuard(new Reflector());
    const as = (role: UserRoleTypes, handler: unknown) =>
      guard.canActivate(
        contextFor(handler as never, AgentEventController as never, {
          user: { sub: 'u', roles: [role] },
        }),
      );

    for (const handler of [proto.listEvents, proto.listIncidents, proto.getDestination]) {
      expect(as(UserRoleTypes.Owner, handler)).toBe(true);
      expect(as(UserRoleTypes.Admin, handler)).toBe(true);
      expect(() => as(UserRoleTypes.User, handler)).toThrow(ForbiddenException);
      expect(() => as(UserRoleTypes.Agent, handler)).toThrow(ForbiddenException);
    }
  });

  it('keeps the destination — set, remove, test — for the owner', () => {
    const guard = new RolesGuard(new Reflector());
    for (const handler of [proto.saveDestination, proto.removeDestination, proto.testDestination]) {
      expect(rolesOf(handler)).toEqual([UserRoleTypes.Owner]);
      expect(() =>
        guard.canActivate(
          contextFor(handler as never, AgentEventController as never, {
            user: { sub: 'u', roles: [UserRoleTypes.Admin] },
          }),
        ),
      ).toThrow(ForbiddenException);
    }
  });
});

describe('the notification destination', () => {
  function harness(stored: INotificationDestination | null = null) {
    let destination = stored;
    const gateway = {
      getDestination: jest.fn(async () => destination),
      saveDestination: jest.fn(async (input: { webhookUrl: string; hint: string; updatedBy: string }) => {
        destination = {
          kind: 'slack',
          ...input,
          updatedAt: new Date('2026-10-06T10:00:00Z'),
          lastDeliveryAt: null,
          lastDeliveryOk: null,
          lastDeliveryError: null,
        };
        return destination;
      }),
      removeDestination: jest.fn(async () => {
        destination = null;
      }),
      recordDelivery: jest.fn(async () => undefined),
    };
    const notifier = { send: jest.fn(async () => ({ ok: true })) };
    const destinations = new NotificationDestinationService(
      gateway as unknown as IAgentEventGateway,
      notifier as unknown as INotifier,
    );
    const controller = new AgentEventController({} as AgentEventService, destinations);
    return { controller, gateway, notifier };
  }
  const owner = { user: { sub: 'user-1', roles: [UserRoleTypes.Owner] } } as never;

  it('says nothing is set on a fresh install', async () => {
    const { controller } = harness();

    expect(await controller.getDestination()).toMatchObject({
      configured: false,
      kind: null,
      hint: null,
      lastDelivery: null,
    });
  });

  it('never hands the address back — not on save, not on read', async () => {
    const { controller } = harness();

    const saved = await controller.saveDestination({ webhookUrl: ADDRESS }, owner);
    const read = await controller.getDestination();

    for (const answer of [saved, read]) {
      const text = JSON.stringify(answer);
      expect(text).not.toContain('SECRETSECRET');
      expect(text).not.toContain('hooks.slack.com');
      expect(text).not.toContain('webhookUrl');
    }
    expect(saved).toMatchObject({
      configured: true,
      kind: 'slack',
      hint: 'CRET',
      updatedBy: 'user-1',
    });
  });

  it.each([
    ['not a URL', 'slack please'],
    ['plain http', 'http://hooks.slack.com/services/T/B/x'],
    ['another host', 'https://example.com/services/T/B/x'],
    ['a host that only starts like Slack', 'https://hooks.slack.com.evil.example/services/T/B/x'],
    ['an address inside the cluster', 'https://ranch-api.platform.svc:3000/agent-events'],
    ['Slack, but not a webhook', 'https://hooks.slack.com/triggers/T/1/x'],
  ])('refuses %s and stores nothing', async (_what, url) => {
    const { controller, gateway } = harness();

    await expect(controller.saveDestination({ webhookUrl: url }, owner)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(gateway.saveDestination).not.toHaveBeenCalled();
  });

  it('sends a test, reports the outcome and records it', async () => {
    const { controller, gateway, notifier } = harness();
    await controller.saveDestination({ webhookUrl: ADDRESS }, owner);

    expect(await controller.testDestination()).toEqual({ delivered: true, error: null });

    expect(notifier.send).toHaveBeenCalledWith(ADDRESS, expect.objectContaining({ text: expect.stringContaining('Test notification') }));
    expect(gateway.recordDelivery).toHaveBeenCalledWith(expect.any(Date), true, null);
  });

  it('reports a failed test with what the destination answered', async () => {
    const { controller, notifier } = harness();
    await controller.saveDestination({ webhookUrl: ADDRESS }, owner);
    notifier.send.mockResolvedValueOnce({
      ok: false,
      retryable: false,
      error: 'Slack answered 404: no_service',
    } as never);

    expect(await controller.testDestination()).toEqual({
      delivered: false,
      error: 'Slack answered 404: no_service',
    });
  });

  it('refuses to test when nothing is set', async () => {
    const { controller } = harness();

    await expect(controller.testDestination()).rejects.toBeInstanceOf(ConflictException);
  });

  it('says whether messages can link to the console', async () => {
    const before = process.env.ADMIN_URL;
    const { controller } = harness();
    try {
      delete process.env.ADMIN_URL;
      delete process.env.ADMIN_BASE_URL;
      expect((await controller.getDestination()).consoleLinks).toBe(false);
      process.env.ADMIN_URL = 'https://admin.ranch.example/';
      expect((await controller.getDestination()).consoleLinks).toBe(true);
    } finally {
      if (before === undefined) delete process.env.ADMIN_URL;
      else process.env.ADMIN_URL = before;
    }
  });
});

describe('GET /agent-incidents', () => {
  it('answers each incident with its state, witnesses and deliveries', async () => {
    const opened = new Date('2026-10-06T21:00:00Z');
    const service = {
      listIncidents: jest.fn(async () => ({
        items: [
          {
            id: 'inc-1',
            agentId: 'a1',
            agentName: 'Support Bot',
            open: true,
            status: 'failed',
            reason: 'OOMKilled',
            ranchWitnessed: true,
            openedAt: opened,
            lastFailureAt: opened,
            upSince: null,
            closedAt: null,
            resolution: null,
            witnesses: ['Ranch', 'cluster-watcher'],
            eventCount: 3,
            notifications: [
              { kind: 'opened', status: 'sent', attempts: 1, sentAt: opened, lastError: null },
            ],
          },
        ],
        nextCursor: 'next',
      })),
    };
    const controller = new AgentEventController(
      service as unknown as AgentEventService,
      {} as NotificationDestinationService,
    );

    const page = await controller.listIncidents({ agentId: 'a1', state: 'open' });

    expect(service.listIncidents).toHaveBeenCalledWith({
      agentId: 'a1',
      state: 'open',
      limit: 50,
      before: undefined,
    });
    expect(page.nextCursor).toBe('next');
    expect(page.items[0]).toMatchObject({
      state: 'open',
      witnesses: ['Ranch', 'cluster-watcher'],
      eventCount: 3,
    });
    expect(page.items[0]).not.toHaveProperty('open');
  });
});
