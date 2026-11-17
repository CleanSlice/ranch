import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { ModuleRef } from '@nestjs/core';
import { Request } from 'express';
import { z } from 'zod';
import { McpToolsHandler } from './mcp-tools.handler';
import { McpRegistryService } from '../mcp-registry.service';
import { TOOL_LISTING_RECORDER } from '../../interfaces/tool-listing-recorder.interface';
import {
  ACTING_PARTY_RESOLVER,
  type IActingPartyResolver,
} from '../../interfaces/acting-party.interface';
import {
  AGENT_MANAGER_RESOLVER,
  type IAgentManagerResolver,
} from '../../interfaces/agent-manager.interface';
import type { ToolAudienceTypes } from '../../decorators';
import { callerParty } from '../../tooling';
import type { ICallerParty } from '#/user/auth/domain/auth.types';
import { UserRoleTypes } from '#/user/user/domain';

/**
 * Per-caller tool listing (CLEAN-74). The rules that matter:
 *  - a tool that says it is not for this caller is absent from tools/list AND
 *    refused by tools/call, because a pod caches the list at connect and can
 *    hold a name that stopped applying to it;
 *  - a tool that says nothing behaves exactly as before;
 *  - a tool whose check throws stays listed — a broken check must never be
 *    able to silently remove a working tool.
 */

type Handler = (request: unknown) => Promise<any>;

interface FakeTool {
  name: string;
  instance: Record<string, unknown>;
  resolveThrows?: boolean;
  /** Defaults to `everyone`, so the per-caller rules below stand alone. */
  audience?: ToolAudienceTypes;
}

interface HarnessOptions {
  recorder?: { record: jest.Mock };
  request?: object;
  /** Who a call is made for (CLEAN-232). None wired: an agent is a guest. */
  resolver?: IActingPartyResolver;
  /** Whether a person manages any agent. None wired: nobody below Admin. */
  manager?: IAgentManagerResolver;
}

/** `_meta["ranch/actor"]`, as a runtime states it. */
type Actor = Record<string, unknown>;

/**
 * Stands in for `ActingPartyService`: takes `trusted` on the agent's word and
 * a person from a table of "tokens", so these specs test what the handler
 * does with the answer. The real verification has its own spec
 * (user/auth/domain/actingToken.spec.ts).
 */
const partyResolver = (
  people: Record<string, ICallerParty> = {},
): IActingPartyResolver => ({
  resolve: (bearer, actor) => {
    const sub = bearer?.sub ?? '';
    if (!sub.startsWith('agent:')) {
      return Promise.resolve({
        kind: 'person',
        userId: sub,
        role: (bearer?.roles ?? [])[0],
      } as ICallerParty);
    }
    if (actor?.kind === 'trusted') return Promise.resolve({ kind: 'trusted' });
    if (actor?.kind === 'person' && typeof actor.token === 'string') {
      return Promise.resolve(people[actor.token] ?? { kind: 'guest' });
    }
    return Promise.resolve({ kind: 'guest' });
  },
});

const TRUSTED: Actor = { kind: 'trusted', via: 'internal' };

function makeHarness(tools: FakeTool[], options: HarnessOptions = {}) {
  const discovered = tools.map((t) => ({
    type: 'tool' as const,
    metadata: {
      name: t.name,
      description: `static description of ${t.name}`,
      parameters: z.object({}),
    },
    providerClass: t.name as unknown as symbol,
    methodName: 'run',
    audience: t.audience ?? 'everyone',
  }));

  const registry = {
    getTools: () => discovered,
    findTool: (name: string) =>
      discovered.find((d) => d.metadata.name === name),
  } as unknown as McpRegistryService;

  const moduleRef = {
    registerRequestByContextId: jest.fn(),
    resolve: jest.fn(async (token: unknown) => {
      const tool = tools.find((t) => t.name === token);
      if (!tool) throw new Error(`no provider for ${String(token)}`);
      if (tool.resolveThrows) throw new Error('resolve blew up');
      return tool.instance;
    }),
    // The listing recorder (CLEAN-109) and the party resolver (CLEAN-232)
    // are both optional lookups by token; anything else is not provided.
    get: jest.fn((token: unknown) => {
      if (token === TOOL_LISTING_RECORDER) return options.recorder;
      if (token === ACTING_PARTY_RESOLVER) return options.resolver;
      if (token === AGENT_MANAGER_RESOLVER && options.manager) {
        return options.manager;
      }
      throw new Error('no such provider');
    }),
  } as unknown as ModuleRef;

  const handlers = new Map<unknown, Handler>();
  const mcpServer = {
    server: {
      transport: { sessionId: undefined },
      setRequestHandler: (schema: unknown, handler: Handler) => {
        handlers.set(schema, handler);
      },
    },
  } as unknown as McpServer;

  const httpRequest = (options.request ?? {
    user: { sub: 'agent:a1' },
  }) as unknown as Request;

  const handler = new McpToolsHandler(moduleRef, registry);
  handler.registerHandlers(mcpServer, httpRequest);

  const meta = (actor?: Actor) =>
    actor ? { _meta: { 'ranch/actor': actor } } : {};
  const list = (actor?: Actor) =>
    handlers.get(ListToolsRequestSchema)!({ params: meta(actor) });
  const call = (name: string, actor?: Actor) =>
    handlers.get(CallToolRequestSchema)!({
      params: { name, arguments: {}, ...meta(actor) },
    });

  return { list, call, httpRequest, moduleRef, registry };
}

const ok = (text: string) => ({ content: [{ type: 'text', text }] });

describe('McpToolsHandler — per-caller listing', () => {
  it('lists a tool that declares no opinion, with its static description', async () => {
    const { list } = makeHarness([
      { name: 'plain', instance: { run: jest.fn(async () => ok('ran')) } },
    ]);

    const result = await list();

    expect(result.tools).toHaveLength(1);
    expect(result.tools[0]).toMatchObject({
      name: 'plain',
      description: 'static description of plain',
    });
  });

  it('omits a tool that is not listed for this caller', async () => {
    const { list } = makeHarness([
      { name: 'plain', instance: { run: jest.fn(async () => ok('ran')) } },
      {
        name: 'ask_agent',
        instance: {
          run: jest.fn(async () => ok('delegated')),
          isListedForRequest: jest.fn(async () => false),
        },
      },
    ]);

    const result = await list();

    expect(result.tools.map((t: { name: string }) => t.name)).toEqual([
      'plain',
    ]);
  });

  it('lists a tool that answers true, and passes the request to the check', async () => {
    const isListedForRequest = jest.fn(async () => true);
    const { list, httpRequest } = makeHarness([
      {
        name: 'ask_agent',
        instance: { run: jest.fn(), isListedForRequest },
      },
    ]);

    const result = await list();

    expect(result.tools).toHaveLength(1);
    // Its own view of the transport request, never the request itself: the
    // party of one call must not be visible to another (CLEAN-232).
    const [[seen]] = isListedForRequest.mock.calls as unknown as [[Request]];
    expect(Object.getPrototypeOf(seen)).toBe(httpRequest);
    expect((seen as unknown as { user: { sub: string } }).user.sub).toBe(
      'agent:a1',
    );
  });

  it('keeps a tool listed when its own check throws', async () => {
    const { list } = makeHarness([
      {
        name: 'ask_agent',
        instance: {
          run: jest.fn(),
          isListedForRequest: jest.fn(async () => {
            throw new Error('gateway down');
          }),
        },
      },
    ]);

    const result = await list();

    expect(result.tools.map((t: { name: string }) => t.name)).toEqual([
      'ask_agent',
    ]);
  });

  it('keeps a tool listed when the provider cannot be resolved', async () => {
    const { list } = makeHarness([
      { name: 'plain', instance: {}, resolveThrows: true },
    ]);

    const result = await list();

    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].description).toBe('static description of plain');
  });

  it('still applies a dynamic description to a listed tool', async () => {
    const { list } = makeHarness([
      {
        name: 'ask_agent',
        instance: {
          run: jest.fn(),
          isListedForRequest: jest.fn(async () => true),
          describeForRequest: jest.fn(async () => 'your peers: «B»'),
        },
      },
    ]);

    const result = await list();

    expect(result.tools[0].description).toBe('your peers: «B»');
  });

  it('never asks for a description of a tool it has already excluded', async () => {
    const describeForRequest = jest.fn(async () => 'never used');
    const { list } = makeHarness([
      {
        name: 'ask_agent',
        instance: {
          run: jest.fn(),
          isListedForRequest: jest.fn(async () => false),
          describeForRequest,
        },
      },
    ]);

    await list();

    expect(describeForRequest).not.toHaveBeenCalled();
  });
});

describe('McpToolsHandler — listing snapshot (CLEAN-109)', () => {
  const flush = () => new Promise((r) => setImmediate(r));

  it('hands the listed names to the recorder for an agent listing for itself', async () => {
    const recorder = { record: jest.fn(async () => undefined) };
    const { list } = makeHarness(
      [
        { name: 'a', instance: { run: jest.fn() } },
        {
          name: 'hidden',
          instance: { run: jest.fn(), isListedForRequest: jest.fn(async () => false) },
        },
        { name: 'b', instance: { run: jest.fn() } },
      ],
      { recorder, resolver: partyResolver() },
    );

    await list(TRUSTED);
    await flush();

    expect(recorder.record).toHaveBeenCalledWith('a1', ['a', 'b']);
  });

  it('does not record a listing made for a person or a guest (CLEAN-232)', async () => {
    // Such a listing is that party's subset. Kept as the pod's snapshot, it
    // would mark every tool the party may not use as missing from the pod.
    const recorder = { record: jest.fn(async () => undefined) };
    const { list } = makeHarness(
      [{ name: 'a', instance: { run: jest.fn() } }],
      {
        recorder,
        resolver: partyResolver({
          'token-of-user': {
            kind: 'person',
            userId: 'user-1',
            role: UserRoleTypes.User,
          },
        }),
      },
    );

    await list({ kind: 'person', token: 'token-of-user' });
    await list({ kind: 'guest' });
    await list();
    await flush();

    expect(recorder.record).not.toHaveBeenCalled();
  });

  it('records nothing for a person listing through the console', async () => {
    const recorder = { record: jest.fn(async () => undefined) };
    const { list } = makeHarness([{ name: 'a', instance: { run: jest.fn() } }], {
      recorder,
      request: { user: { sub: 'user-7', roles: ['owner'] } },
    });

    await list();
    await flush();

    expect(recorder.record).not.toHaveBeenCalled();
  });

  it('lists as before when no recorder is wired or the recorder fails', async () => {
    const { list: listWithout } = makeHarness([
      { name: 'a', instance: { run: jest.fn() } },
    ]);
    expect((await listWithout()).tools).toHaveLength(1);

    const failing = {
      record: jest.fn(async () => {
        throw new Error('db down');
      }),
    };
    const { list } = makeHarness(
      [{ name: 'a', instance: { run: jest.fn() } }],
      {
        recorder: failing,
        resolver: partyResolver(),
      },
    );
    const result = await list(TRUSTED);
    await flush();
    expect(result.tools).toHaveLength(1);
    expect(failing.record).toHaveBeenCalledTimes(1);
  });
});

/**
 * CLEAN-232. The Ranch admin agent's token carries Owner, and it answers
 * whoever is chatting with it. So every tools/list and tools/call says who
 * it is made for, and a tool is offered and run only when both the token and
 * that party may have it.
 */
describe('McpToolsHandler — who the call is made for (CLEAN-232)', () => {
  const RANCH = {
    user: { sub: 'agent:ranch', email: '', roles: [UserRoleTypes.Owner] },
  };
  const people: Record<string, ICallerParty> = {
    'token-of-user': {
      kind: 'person',
      userId: 'user-1',
      role: UserRoleTypes.User,
    },
    'token-of-admin': {
      kind: 'person',
      userId: 'user-a',
      role: UserRoleTypes.Admin,
    },
    'token-of-owner': {
      kind: 'person',
      userId: 'user-o',
      role: UserRoleTypes.Owner,
    },
  };
  const asUser: Actor = { kind: 'person', token: 'token-of-user' };
  const asAdmin: Actor = { kind: 'person', token: 'token-of-admin' };
  const asOwner: Actor = { kind: 'person', token: 'token-of-owner' };

  const ranch = (run = jest.fn(async () => ok('done'))) => ({
    run,
    ...makeHarness(
      [
        { name: 'query_knowledge', instance: { run }, audience: 'everyone' },
        { name: 'browser_session_list', instance: { run }, audience: 'person' },
        { name: 'delete_agent', instance: { run }, audience: 'admin' },
        { name: 'delete_user', instance: { run }, audience: 'owner' },
      ],
      { request: RANCH, resolver: partyResolver(people) },
    ),
  });
  const namesOf = (result: { tools: { name: string }[] }) =>
    result.tools.map((t) => t.name);

  it('lists per party: the same session, four different catalogues', async () => {
    const { list } = ranch();

    expect(namesOf(await list(asUser))).toEqual([
      'query_knowledge',
      'browser_session_list',
    ]);
    expect(namesOf(await list(asAdmin))).toEqual([
      'query_knowledge',
      'browser_session_list',
      'delete_agent',
    ]);
    expect(namesOf(await list(asOwner))).toHaveLength(4);
    expect(namesOf(await list(TRUSTED))).toEqual([
      'query_knowledge',
      'delete_agent',
      'delete_user',
    ]);
  });

  it('no actor means guest: an old runtime loses the management tools', async () => {
    const { list, call, run } = ranch();

    expect(namesOf(await list())).toEqual(['query_knowledge']);
    expect(namesOf(await list({ kind: 'guest' }))).toEqual(['query_knowledge']);

    const result = await call('delete_agent');
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      'Tool "delete_agent" is not available to this caller.',
    );
    expect(run).not.toHaveBeenCalled();
  });

  it('refuses a User the call the Owner may make, before the tool is even resolved', async () => {
    const { call, run, moduleRef } = ranch();

    const refused = await call('delete_agent', asUser);
    expect(refused.isError).toBe(true);
    expect(refused.content[0].text).toContain('not available to this caller');
    expect(run).not.toHaveBeenCalled();
    expect(
      (moduleRef as unknown as Record<string, jest.Mock>).resolve,
    ).not.toHaveBeenCalled();

    const done = await call('delete_agent', asOwner);
    expect(done.content[0].text).toBe('done');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('refuses an Admin an owner tool and a person with a token it cannot prove', async () => {
    const { call, run } = ranch();

    expect((await call('delete_user', asAdmin)).isError).toBe(true);
    expect(
      (await call('delete_agent', { kind: 'person', token: 'made-up' }))
        .isError,
    ).toBe(true);
    expect(
      (await call('delete_agent', { kind: 'person', userId: 'user-o' }))
        .isError,
    ).toBe(true);
    expect(run).not.toHaveBeenCalled();
  });

  it('hands the tool a request that carries the party, and leaves the session request alone', async () => {
    const seen: ICallerParty[] = [];
    const run = jest.fn(async (_args: unknown, _ctx: unknown, req: Request) => {
      seen.push(callerParty(req));
      return ok('done');
    });
    const { call, httpRequest } = ranch(run as never);

    // One MCP session, two people, at once.
    await Promise.all([
      call('query_knowledge', asUser),
      call('query_knowledge', asOwner),
    ]);

    expect(seen).toEqual(
      expect.arrayContaining([
        people['token-of-user'],
        people['token-of-owner'],
      ]),
    );
    expect(seen).toHaveLength(2);
    // Nothing was written onto the shared transport request: read without a
    // party it is still an agent naming nobody.
    expect(Object.keys(httpRequest)).toEqual(['user']);
    expect(Object.getOwnPropertyNames(httpRequest).includes('ranchParty')).toBe(
      false,
    );
    expect(callerParty(httpRequest)).toEqual({ kind: 'guest' });
  });

  it('says each tool’s audience in the listing', async () => {
    const { list } = ranch();
    const result = await list(asOwner);

    expect(
      result.tools.map((t: { name: string; _meta: Record<string, string> }) => [
        t.name,
        t._meta['ranch/audience'],
      ]),
    ).toEqual([
      ['query_knowledge', 'everyone'],
      ['browser_session_list', 'person'],
      ['delete_agent', 'admin'],
      ['delete_user', 'owner'],
    ]);
  });

  it('fails closed without a resolver: an agent is a guest, even stating trusted', async () => {
    const run = jest.fn(async () => ok('done'));
    const { list, call } = makeHarness(
      [
        { name: 'query_knowledge', instance: { run }, audience: 'everyone' },
        { name: 'delete_agent', instance: { run }, audience: 'admin' },
      ],
      { request: RANCH },
    );

    expect(namesOf(await list(TRUSTED))).toEqual(['query_knowledge']);
    expect((await call('delete_agent', TRUSTED)).isError).toBe(true);
    expect(run).not.toHaveBeenCalled();
  });

  it('fails closed when the resolver throws', async () => {
    const run = jest.fn(async () => ok('done'));
    const { call } = makeHarness(
      [{ name: 'delete_agent', instance: { run }, audience: 'admin' }],
      {
        request: RANCH,
        resolver: {
          resolve: () => Promise.reject(new Error('database is down')),
        },
      },
    );

    expect((await call('delete_agent', TRUSTED)).isError).toBe(true);
    expect(run).not.toHaveBeenCalled();
  });

  it('a person’s own console token speaks for them, with or without a resolver', async () => {
    const tools = (): FakeTool[] => [
      {
        name: 'browser_session_list',
        instance: { run: jest.fn() },
        audience: 'person',
      },
      { name: 'delete_agent', instance: { run: jest.fn() }, audience: 'admin' },
      { name: 'delete_user', instance: { run: jest.fn() }, audience: 'owner' },
    ];
    const admin = {
      user: { sub: 'user-a', email: '', roles: [UserRoleTypes.Admin] },
    };
    const user = {
      user: { sub: 'user-1', email: '', roles: [UserRoleTypes.User] },
    };

    for (const resolver of [partyResolver(), undefined]) {
      expect(
        namesOf(
          await makeHarness(tools(), { request: admin, resolver }).list(),
        ),
      ).toEqual(['browser_session_list', 'delete_agent']);
      // Stating trusted changes nothing for a person.
      expect(
        namesOf(
          await makeHarness(tools(), { request: user, resolver }).list(TRUSTED),
        ),
      ).toEqual(['browser_session_list']);
    }
  });

  it('never runs a tool that declared no audience', async () => {
    const run = jest.fn(async () => ok('done'));
    const harness = makeHarness([{ name: 'undeclared', instance: { run } }], {
      request: RANCH,
      resolver: partyResolver(people),
    });
    // What a registry entry without @ToolAudience looks like.
    delete (
      harness as unknown as {
        registry: { getTools: () => { audience?: string }[] };
      }
    ).registry.getTools()[0].audience;

    expect(namesOf(await harness.list(TRUSTED))).toEqual([]);
    expect((await harness.call('undeclared', asOwner)).isError).toBe(true);
    expect(run).not.toHaveBeenCalled();
  });
});

describe('McpToolsHandler — the manage-agent audience (CLEAN-232)', () => {
  const RANCH = {
    user: { sub: 'agent:ranch', email: '', roles: [UserRoleTypes.Owner] },
  };
  const people: Record<string, ICallerParty> = {
    creator: { kind: 'person', userId: 'user-c', role: UserRoleTypes.User },
    other: { kind: 'person', userId: 'user-x', role: UserRoleTypes.User },
    admin: { kind: 'person', userId: 'user-a', role: UserRoleTypes.Admin },
  };
  const as = (token: string): Actor => ({ kind: 'person', token });
  /** Only `user-c` created an agent. */
  const manager = () => ({
    managesAny: jest.fn((person: { userId: string }) =>
      Promise.resolve(person.userId === 'user-c'),
    ),
  });

  const ranch = (
    options: Pick<HarnessOptions, 'manager' | 'request'> = {},
    run = jest.fn(async () => ok('done')),
  ) => ({
    run,
    ...makeHarness(
      [
        { name: 'query_knowledge', instance: { run }, audience: 'everyone' },
        { name: 'stop_agent', instance: { run }, audience: 'manage-agent' },
        { name: 'create_user', instance: { run }, audience: 'admin' },
      ],
      { request: RANCH, resolver: partyResolver(people), ...options },
    ),
  });
  const namesOf = (result: { tools: { name: string }[] }) =>
    result.tools.map((t) => t.name);

  it('lists the tools for a User who created an agent, and runs the call', async () => {
    const { list, call, run } = ranch({ manager: manager() });

    expect(namesOf(await list(as('creator')))).toEqual([
      'query_knowledge',
      'stop_agent',
    ]);
    const result = await call('stop_agent', as('creator'));
    expect(result.isError).toBeUndefined();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('not for a User who created none: not listed, and refused by name', async () => {
    const { list, call, run } = ranch({ manager: manager() });

    expect(namesOf(await list(as('other')))).toEqual(['query_knowledge']);
    const result = await call('stop_agent', as('other'));
    expect(result.content[0].text).toBe(
      'Tool "stop_agent" is not available to this caller.',
    );
    expect(run).not.toHaveBeenCalled();
  });

  it('an Admin and a trusted agent have them without anyone being asked', async () => {
    const asked = manager();
    const { list } = ranch({ manager: asked });

    expect(namesOf(await list(as('admin')))).toEqual([
      'query_knowledge',
      'stop_agent',
      'create_user',
    ]);
    expect(namesOf(await list(TRUSTED))).toContain('stop_agent');
    expect(asked.managesAny).not.toHaveBeenCalled();
  });

  it('a guest is never asked about, and gets none', async () => {
    const asked = manager();
    const { list } = ranch({ manager: asked });

    expect(namesOf(await list())).toEqual(['query_knowledge']);
    expect(asked.managesAny).not.toHaveBeenCalled();
  });

  it('asks once per call, about the person the call is made for', async () => {
    const asked = manager();
    const { list } = ranch({ manager: asked });

    await list(as('creator'));
    await list(as('other'));

    expect(asked.managesAny.mock.calls.map(([p]) => p)).toEqual([
      { userId: 'user-c', role: UserRoleTypes.User },
      { userId: 'user-x', role: UserRoleTypes.User },
    ]);
  });

  it('fails closed with nothing wired to answer', async () => {
    const { list } = ranch();
    expect(namesOf(await list(as('creator')))).toEqual(['query_knowledge']);
  });

  it('fails closed when the answer cannot be had', async () => {
    const { list } = ranch({
      manager: {
        managesAny: jest.fn(() => Promise.reject(new Error('db is down'))),
      },
    });
    expect(namesOf(await list(as('creator')))).toEqual(['query_knowledge']);
  });

  it('anything but a plain yes is a no', async () => {
    const { list } = ranch({
      manager: {
        managesAny: jest.fn(() => Promise.resolve('yes' as never)),
      },
    });
    expect(namesOf(await list(as('creator')))).toEqual(['query_knowledge']);
  });

  it('a creator on their own console token is shown them too', async () => {
    const { list } = ranch({
      manager: manager(),
      request: {
        user: { sub: 'user-c', email: '', roles: [UserRoleTypes.User] },
      },
    });
    expect(namesOf(await list())).toEqual(['query_knowledge', 'stop_agent']);
  });

  it('one session, two people: the answer for one never reaches the other', async () => {
    const { list } = ranch({ manager: manager() });

    const [forCreator, forOther] = await Promise.all([
      list(as('creator')),
      list(as('other')),
    ]);

    expect(namesOf(forCreator)).toContain('stop_agent');
    expect(namesOf(forOther)).not.toContain('stop_agent');
  });
});

describe('McpToolsHandler — per-caller calling', () => {
  it('refuses a call to a tool that is not listed for this caller', async () => {
    const run = jest.fn(async () => ok('delegated'));
    const { call } = makeHarness([
      {
        name: 'ask_agent',
        instance: { run, isListedForRequest: jest.fn(async () => false) },
      },
    ]);

    const result = await call('ask_agent');

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not available to this caller');
    expect(run).not.toHaveBeenCalled();
  });

  it('runs a tool that is listed for this caller', async () => {
    const run = jest.fn(async () => ok('delegated'));
    const { call } = makeHarness([
      {
        name: 'ask_agent',
        instance: { run, isListedForRequest: jest.fn(async () => true) },
      },
    ]);

    const result = await call('ask_agent');

    expect(result.content[0].text).toBe('delegated');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('runs a tool that declares no opinion', async () => {
    const run = jest.fn(async () => ok('ran'));
    const { call } = makeHarness([{ name: 'plain', instance: { run } }]);

    const result = await call('plain');

    expect(result.content[0].text).toBe('ran');
    expect(run).toHaveBeenCalledTimes(1);
  });
});
