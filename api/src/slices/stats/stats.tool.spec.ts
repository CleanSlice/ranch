import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  MCP_TOOL_METADATA_KEY,
  toolAudienceOf,
  type ToolMetadata,
} from '#/mcp/decorators';
import { toolMetadataProblems } from '#/mcp/services/mcp-registry.service';
import { asGuest, asPeer, asPerson, asTrustedAgent } from '#/mcp/testing';
import { GUEST_REFUSAL, OPERATOR_REFUSAL, audienceAllows } from '#/mcp/tooling';
import {
  ADMIN,
  OWNER,
  accessHarness,
} from '#/user/agentAccess/domain/__fixtures__/agentAccess';
import type { IAccessCaller } from '#/user/agentAccess/domain/agentAccess.types';
import { UserRoleTypes } from '#/user/user/domain';
import {
  IInstallationQuestion,
  IInstallationStats,
  IPersonalStats,
  IStatsQuestion,
  IStatsViewer,
  InstallationStatsService,
  PersonalStatsService,
} from './domain';
import { installationHarness } from './domain/__fixtures__/installationStats';
import { statsHarness } from './domain/__fixtures__/personalStats';
import { InstallationStatsController } from './installationStats.controller';
import { MyStatsController } from './myStats.controller';
import { StatsTool } from './stats.tool';

/**
 * `get_my_stats` is the Statistics tab from the chat: the same service, for
 * the person the call is made for. What matters most here is whose figures
 * come back. The tool has no argument that names a person, the Ranch admin
 * agent's own Owner token decides nothing, and a call with nobody behind it
 * is refused before anything is read.
 */

/** The Ranch admin agent's request: its token carries Owner. */
const ranchAgent = (): Request =>
  ({
    user: { sub: 'agent:ranch', email: '', roles: [UserRoleTypes.Owner] },
  }) as unknown as Request;

const answering = (role: UserRoleTypes, userId: string) =>
  asPerson(ranchAgent(), role, userId);

// The method as the registry reads it at boot: off the prototype, by name.
const method = Object.getOwnPropertyDescriptor(
  StatsTool.prototype,
  'getMyStats',
)?.value as (...args: unknown[]) => unknown;

const metadata = Reflect.getMetadata(
  MCP_TOOL_METADATA_KEY,
  method,
) as ToolMetadata;

/** A service that records what it was asked and answers a marker. */
function recording() {
  const answer = {
    period: 30,
    timeZone: 'UTC',
    range: { from: new Date('2026-10-29T00:00:00.000Z') },
    board: { messages: { value: 12, previous: 9 } },
  } as unknown as IPersonalStats;
  const forPerson = jest.fn(
    (_viewer: IStatsViewer, _question: IStatsQuestion) =>
      Promise.resolve(answer),
  );
  const installationAnswer = {
    period: 30,
    range: { from: new Date('2026-10-29T00:00:00.000Z') },
    reach: { limited: false, agents: 3, ownerOnly: [] },
    board: { calls: { value: 812, previous: 640 } },
  } as unknown as IInstallationStats;
  const forCaller = jest.fn(
    (_caller: IAccessCaller, _question: IInstallationQuestion) =>
      Promise.resolve(installationAnswer),
  );
  const tool = new StatsTool(
    { forPerson } as unknown as PersonalStatsService,
    { forCaller } as unknown as InstallationStatsService,
  );
  return { tool, forPerson, answer, forCaller, installationAnswer };
}

const textOf = (result: { content: { text: string }[] }) =>
  result.content[0].text;

describe('get_my_stats: what the tool says it is', () => {
  it('carries the metadata the API refuses to boot without', () => {
    expect(toolMetadataProblems(metadata)).toEqual([]);
    expect(metadata).toMatchObject({
      name: 'get_my_stats',
      topic: 'chats_usage',
      effect: 'read',
      title: 'Your statistics',
      template: 'How many conversations did I have this month?',
    });
    expect(metadata.destructive).toBeFalsy();
  });

  it('is a `person` tool: any signed-in person, and nobody else', () => {
    const audience = toolAudienceOf(StatsTool, method);
    expect(audience).toBe('person');

    expect(audienceAllows(audience, answering(UserRoleTypes.User, 'u'))).toBe(
      true,
    );
    expect(audienceAllows(audience, answering(UserRoleTypes.Admin, 'a'))).toBe(
      true,
    );
    expect(audienceAllows(audience, answering(UserRoleTypes.Owner, 'o'))).toBe(
      true,
    );
    expect(audienceAllows(audience, asGuest(ranchAgent()))).toBe(false);
    // The agent acting for itself has no statistics of its own.
    expect(audienceAllows(audience, asTrustedAgent(ranchAgent()))).toBe(false);
  });

  it('takes a period and a time zone, both optional, and no person', () => {
    const schema = zodToJsonSchema(metadata.parameters as never) as {
      properties: Record<string, unknown>;
      required?: string[];
    };

    expect(Object.keys(schema.properties).sort()).toEqual([
      'period',
      'timeZone',
    ]);
    expect(schema.required ?? []).toEqual([]);
    expect(JSON.stringify(schema.properties.period)).toContain('90');
  });

  it('tells the model whose figures these are and that nothing written comes back', () => {
    expect(metadata.description).toMatch(/person (who is )?asking|their own/i);
    expect(metadata.description).toContain('7, 30 or 90');
  });
});

describe('get_my_stats: whose statistics', () => {
  it('answers for the person the call is made for, not for the agent’s Owner token', async () => {
    const { tool, forPerson } = recording();
    const request = answering(UserRoleTypes.User, 'user-7');

    await tool.getMyStats({}, undefined, request);

    expect(forPerson).toHaveBeenCalledWith(
      {
        userId: 'user-7',
        clientId: 'user-7',
        caller: { kind: 'person', userId: 'user-7', role: UserRoleTypes.User },
      },
      { period: 30, timeZone: undefined },
    );
  });

  it('reads an Admin under their own id, and the Owner’s conversations under `admin`', async () => {
    const { tool, forPerson } = recording();

    await tool.getMyStats(
      {},
      undefined,
      answering(UserRoleTypes.Admin, 'admin-3'),
    );
    await tool.getMyStats(
      {},
      undefined,
      answering(UserRoleTypes.Owner, 'owner-1'),
    );

    expect(forPerson.mock.calls.map(([viewer]) => viewer)).toEqual([
      {
        userId: 'admin-3',
        clientId: 'admin-3',
        caller: {
          kind: 'person',
          userId: 'admin-3',
          role: UserRoleTypes.Admin,
        },
      },
      {
        userId: 'owner-1',
        clientId: 'admin',
        caller: {
          kind: 'person',
          userId: 'owner-1',
          role: UserRoleTypes.Owner,
        },
      },
    ]);
  });

  it('answers a person on their own console token as that person', async () => {
    const { tool, forPerson } = recording();
    const own = {
      user: { sub: 'user-9', email: '', roles: [UserRoleTypes.User] },
    } as unknown as Request;

    await tool.getMyStats({}, undefined, own);

    expect(forPerson.mock.calls[0][0]).toMatchObject({
      userId: 'user-9',
      clientId: 'user-9',
    });
  });

  it('has no way to be pointed at somebody else: an argument that names a person is not read', async () => {
    const { tool, forPerson } = recording();
    const args = {
      period: 7,
      userId: 'user-2',
      clientId: 'admin',
      person: 'user-2',
    } as never;

    await tool.getMyStats(args, undefined, answering(UserRoleTypes.User, 'u1'));

    expect(forPerson).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', clientId: 'u1' }),
      { period: 7, timeZone: undefined },
    );
  });

  it('refuses a call with nobody behind it: "This needs a signed-in person."', async () => {
    const { tool, forPerson } = recording();
    const nobodies = [
      // A share visitor, a messenger user, a runtime that names no actor.
      asGuest(ranchAgent()),
      ranchAgent(),
      // The agent acting for itself, Owner token and all.
      asTrustedAgent(ranchAgent()),
      // A colleague's question, even one started for a person.
      asPeer(ranchAgent(), { forUserId: 'user-7' }),
    ];

    for (const request of nobodies) {
      const refused = tool.getMyStats({}, undefined, request);
      await expect(refused).rejects.toBeInstanceOf(ForbiddenException);
      await expect(refused).rejects.toThrow('This needs a signed-in person.');
    }
    expect(forPerson).not.toHaveBeenCalled();
  });
});

describe('get_my_stats: what it asks for and what it answers', () => {
  it('answers with what the service answered, and nothing else', async () => {
    const { tool, answer } = recording();

    const result = await tool.getMyStats(
      {},
      undefined,
      answering(UserRoleTypes.User, 'user-7'),
    );

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(textOf(result))).toEqual(
      JSON.parse(JSON.stringify(answer)),
    );
  });

  it('asks for 30 days unless told, and passes the period and the zone on', async () => {
    const { tool, forPerson } = recording();
    const request = () => answering(UserRoleTypes.User, 'user-7');

    await tool.getMyStats({}, undefined, request());
    await tool.getMyStats({ period: 7 }, undefined, request());
    await tool.getMyStats(
      { period: 90, timeZone: 'Europe/Kyiv' },
      undefined,
      request(),
    );

    expect(forPerson.mock.calls.map(([, question]) => question)).toEqual([
      { period: 30, timeZone: undefined },
      { period: 7, timeZone: undefined },
      { period: 90, timeZone: 'Europe/Kyiv' },
    ]);
  });

  it('reads a period of null as no period: a model writes that for "not given"', async () => {
    const { tool, forPerson } = recording();

    await tool.getMyStats(
      { period: null },
      undefined,
      answering(UserRoleTypes.User, 'user-7'),
    );

    expect(forPerson.mock.calls[0][1]).toEqual({
      period: 30,
      timeZone: undefined,
    });
  });

  // Nothing checks a tool's arguments against its schema before the call:
  // what the model wrote is what arrives.
  it('refuses a period that is not 7, 30 or 90, says which are, and reads nothing', async () => {
    const { tool, forPerson } = recording();

    for (const period of [14, 0, 365, '30', 'month', [7]]) {
      const result = await tool.getMyStats(
        { period } as never,
        undefined,
        answering(UserRoleTypes.User, 'user-7'),
      );
      expect([period, result.isError]).toEqual([period, true]);
      expect(textOf(result)).toContain('7, 30 or 90');
    }
    expect(forPerson).not.toHaveBeenCalled();
  });

  it('gives the same answer the route gives that person', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-27T10:30:00.000Z') });
    try {
      const { service } = statsHarness({
        agents: [{ id: 'a1', name: 'Atlas', model: 'claude-sonnet-4-6' }],
        hours: [
          {
            sessionId: 'c1',
            agentId: 'a1',
            externalUserId: 'user-7',
            hour: '2026-11-25T09:00:00Z',
            userMessages: 3,
            agentMessages: 2,
          },
          // The Owner's conversation: nothing of it may show.
          {
            sessionId: 'c2',
            agentId: 'a1',
            externalUserId: 'admin',
            hour: '2026-11-25T09:00:00Z',
            userMessages: 40,
            agentMessages: 40,
          },
        ],
      });
      const viaTool = await new StatsTool(
        service,
        {} as InstallationStatsService,
      ).getMyStats(
        { period: 7, timeZone: 'Europe/Kyiv' },
        undefined,
        answering(UserRoleTypes.User, 'user-7'),
      );
      const viaRoute = await new MyStatsController(service).get(
        { period: 7, tz: 'Europe/Kyiv' },
        {
          user: { sub: 'user-7', email: '', roles: [UserRoleTypes.User] },
        } as never,
      );

      const fromTool = JSON.parse(textOf(viaTool)) as {
        board: { messages: { value: number } };
      };
      expect(fromTool).toEqual(JSON.parse(JSON.stringify(viaRoute)));
      expect(fromTool.board.messages.value).toBe(3);
    } finally {
      jest.useRealTimers();
    }
  });
});

/**
 * `get_installation_stats` is the "Whole installation" side of the same tab
 * (CLEAN-265): the service `GET /stats/installation` calls, for the party
 * the call is made for. Two things matter here. The Ranch admin agent's
 * token carries Owner, and it must not answer a User with it. And an Admin
 * who is limited to some agents is limited in the chat exactly as in the
 * console.
 */

const installationMethod = Object.getOwnPropertyDescriptor(
  StatsTool.prototype,
  'getInstallationStats',
)?.value as (...args: unknown[]) => unknown;

const installationMetadata = Reflect.getMetadata(
  MCP_TOOL_METADATA_KEY,
  installationMethod,
) as ToolMetadata;

describe('get_installation_stats: what the tool says it is', () => {
  it('carries the metadata the API refuses to boot without', () => {
    expect(toolMetadataProblems(installationMetadata)).toEqual([]);
    expect(installationMetadata).toMatchObject({
      name: 'get_installation_stats',
      topic: 'chats_usage',
      effect: 'read',
      title: 'Installation statistics',
      template:
        'What did the agents cost in the last 90 days, and which had incidents?',
    });
    expect(installationMetadata.destructive).toBeFalsy();
  });

  it('is an `admin` tool in a `person` class: the audience is on the method', () => {
    expect(toolAudienceOf(StatsTool, undefined)).toBe('person');
    const audience = toolAudienceOf(StatsTool, installationMethod);
    expect(audience).toBe('admin');

    expect(audienceAllows(audience, answering(UserRoleTypes.Admin, 'a'))).toBe(
      true,
    );
    expect(audienceAllows(audience, answering(UserRoleTypes.Owner, 'o'))).toBe(
      true,
    );
    // The Ranch admin agent on its own schedule keeps it, as it keeps
    // `get_usage_overview`.
    expect(audienceAllows(audience, asTrustedAgent(ranchAgent()))).toBe(true);
    expect(audienceAllows(audience, answering(UserRoleTypes.User, 'u'))).toBe(
      false,
    );
    expect(audienceAllows(audience, asGuest(ranchAgent()))).toBe(false);
    expect(audienceAllows(audience, ranchAgent())).toBe(false);
  });

  // The catalogue lists a tool by its own audience before it asks the class
  // anything. The class has no `isListedForRequest`: one that answered for
  // the widest audience here would be right, and one that answered "is an
  // operator" would take `get_my_stats` away from every User.
  it('is never shown to a User, who keeps `get_my_stats`', () => {
    const user = () => answering(UserRoleTypes.User, 'user-7');

    expect(
      audienceAllows(toolAudienceOf(StatsTool, installationMethod), user()),
    ).toBe(false);
    expect(audienceAllows(toolAudienceOf(StatsTool, method), user())).toBe(
      true,
    );
    expect('isListedForRequest' in StatsTool.prototype).toBe(false);
  });

  it('takes a period, optional, and nothing that names a person or an agent', () => {
    const schema = zodToJsonSchema(
      installationMetadata.parameters as never,
    ) as {
      properties: Record<string, unknown>;
      required?: string[];
    };

    expect(Object.keys(schema.properties)).toEqual(['period']);
    expect(schema.required ?? []).toEqual([]);
    expect(JSON.stringify(schema.properties.period)).toContain('90');
  });

  it('tells the model what it covers, that cost is an estimate and that nobody is named', () => {
    const { description } = installationMetadata;

    expect(description).toContain('7, 30 or 90');
    expect(description).toMatch(
      /agents the (person asking|caller) (can use|reaches)/i,
    );
    expect(description).toMatch(/price list/i);
    expect(description).toMatch(/UTC/);
    expect(description).toMatch(/no person/i);
  });

  // Whoever leaves an agent's conversations out owes the reason (CLEAN-267):
  // the model can only pass on what the description told it.
  it('tells the model why some conversations are not counted, and what to say when nothing priced ran', () => {
    const { description } = installationMetadata;

    expect(description).toContain('`reach.ownerOnly`');
    expect(description).toMatch(/only the Owner/);
    expect(description).toMatch(/no model with a price/);
  });
});

describe('get_installation_stats: who may ask, and for which agents', () => {
  it('refuses the Ranch admin agent answering a User, and reads nothing', async () => {
    const { tool, forCaller } = recording();

    const refused = tool.getInstallationStats(
      {},
      undefined,
      answering(UserRoleTypes.User, 'user-7'),
    );

    await expect(refused).rejects.toBeInstanceOf(ForbiddenException);
    await expect(refused).rejects.toThrow(OPERATOR_REFUSAL);
    expect(forCaller).not.toHaveBeenCalled();
  });

  it('refuses a call with nobody behind it: "This needs a signed-in administrator."', async () => {
    const { tool, forCaller } = recording();
    const nobodies = [
      asGuest(ranchAgent()),
      ranchAgent(),
      // A colleague's question, even one started for the Owner.
      asPeer(ranchAgent(), { forUserId: 'owner-1' }),
    ];

    for (const request of nobodies) {
      const refused = tool.getInstallationStats({}, undefined, request);
      await expect(refused).rejects.toBeInstanceOf(ForbiddenException);
      await expect(refused).rejects.toThrow(GUEST_REFUSAL);
    }
    expect(forCaller).not.toHaveBeenCalled();
  });

  it('refuses a User on their own console token, and a plain agent acting for itself', async () => {
    const { tool, forCaller } = recording();
    const own = {
      user: { sub: 'user-9', email: '', roles: [UserRoleTypes.User] },
    } as unknown as Request;
    const plainAgent = asTrustedAgent({
      user: { sub: 'agent:helper', email: '', roles: [UserRoleTypes.Agent] },
    } as unknown as Request);

    for (const request of [own, plainAgent]) {
      await expect(
        tool.getInstallationStats({}, undefined, request),
      ).rejects.toThrow(OPERATOR_REFUSAL);
    }
    expect(forCaller).not.toHaveBeenCalled();
  });

  it('asks the service as the party the call is made for, not as the agent’s Owner token', async () => {
    const { tool, forCaller } = recording();

    await tool.getInstallationStats(
      {},
      undefined,
      answering(UserRoleTypes.Admin, 'admin-3'),
    );
    await tool.getInstallationStats(
      {},
      undefined,
      answering(UserRoleTypes.Owner, 'owner-1'),
    );
    await tool.getInstallationStats(
      {},
      undefined,
      asTrustedAgent(ranchAgent()),
    );

    expect(forCaller.mock.calls.map(([caller]) => caller)).toEqual([
      { kind: 'person', userId: 'admin-3', role: UserRoleTypes.Admin },
      { kind: 'person', userId: 'owner-1', role: UserRoleTypes.Owner },
      // The agent on its own schedule: no person, so no lists apply.
      { kind: 'trusted' },
    ]);
  });

  it('answers an Admin on their own console token as that Admin', async () => {
    const { tool, forCaller } = recording();
    const own = {
      user: { sub: 'admin-9', email: '', roles: [UserRoleTypes.Admin] },
    } as unknown as Request;

    await tool.getInstallationStats({}, undefined, own);

    expect(forCaller.mock.calls[0][0]).toEqual({
      kind: 'person',
      userId: 'admin-9',
      role: UserRoleTypes.Admin,
    });
  });

  it('has no way to be pointed at other agents or another account: such an argument is not read', async () => {
    const { tool, forCaller } = recording();
    const args = {
      period: 7,
      userId: 'owner-1',
      role: 'Owner',
      agentId: 'agent-3',
      agentIds: ['agent-3'],
    } as never;

    await tool.getInstallationStats(
      args,
      undefined,
      answering(UserRoleTypes.Admin, 'admin-3'),
    );

    expect(forCaller).toHaveBeenCalledWith(
      { kind: 'person', userId: 'admin-3', role: UserRoleTypes.Admin },
      { period: 7 },
    );
  });

  // The whole way: the real service over the real access lists. An agent
  // outside the Admin's reach is in no list and no total of the answer.
  it('shows a limited Admin only the agents they reach, as the route does', async () => {
    const { service: access, gateway: lists } = accessHarness(['a1', 'a2']);
    lists.seed(ADMIN.id, true, [{ agentId: 'a1', list: 'allowed' }]);
    const today = new Date().toISOString().slice(0, 10);
    const { service } = installationHarness(
      {
        agents: [
          { id: 'a1', name: 'Atlas' },
          { id: 'a2', name: 'Beacon-hidden' },
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
    const tool = new StatsTool({} as PersonalStatsService, service);
    type Answer = {
      reach: { limited: boolean; agents: number; ownerOnly: string[] };
      board: { calls: { value: number } };
      range: unknown;
    };
    const without = <T extends Answer>(answer: T) => ({
      ...answer,
      // The moment each was computed, a few milliseconds apart.
      range: undefined,
    });

    const mine = textOf(
      await tool.getInstallationStats(
        {},
        undefined,
        answering(ADMIN.role, ADMIN.id),
      ),
    );
    const whole = textOf(
      await tool.getInstallationStats(
        {},
        undefined,
        answering(OWNER.role, OWNER.id),
      ),
    );
    const viaRoute = await new InstallationStatsController(service).get({}, {
      user: { sub: ADMIN.id, email: '', roles: [ADMIN.role] },
    } as never);

    expect(mine).not.toContain('a2');
    expect(mine).not.toContain('Beacon-hidden');
    expect((JSON.parse(mine) as Answer).reach).toEqual({
      limited: true,
      agents: 1,
      ownerOnly: [],
    });
    expect((JSON.parse(mine) as Answer).board.calls.value).toBe(4);
    expect(whole).toContain('Beacon-hidden');
    expect((JSON.parse(whole) as Answer).board.calls.value).toBe(40);
    expect(without(JSON.parse(mine) as Answer)).toEqual(
      without(JSON.parse(JSON.stringify(viaRoute)) as Answer),
    );
  });

  // CLEAN-236, as chat history has it: what people said to the Ranch
  // assistant is the Owner's. An Admin asking through that very assistant
  // gets what it cost and how it fared, and no figure made from its
  // conversations, with its name as the reason.
  it('leaves the assistant’s conversations out for an Admin and says so, and keeps its spend, refusals and incidents', async () => {
    const { service: access } = accessHarness(['a1', 'ranch']);
    const now = Date.now();
    const today = new Date(now).toISOString().slice(0, 10);
    const hourAgo = new Date(now - 60 * 60 * 1000).toISOString();
    const { service } = installationHarness(
      {
        agents: [
          { id: 'a1', name: 'Atlas' },
          { id: 'ranch', name: 'Ranch', admin: true },
        ],
        hours: [
          {
            sessionId: 'c1',
            agentId: 'a1',
            externalUserId: 'u1',
            hour: hourAgo,
            userMessages: 1,
            agentMessages: 1,
          },
          {
            sessionId: 'c2',
            agentId: 'ranch',
            externalUserId: 'u2',
            channel: 'telegram',
            hour: hourAgo,
            userMessages: 1,
            agentMessages: 1,
          },
        ],
        ratings: [{ agentId: 'ranch', rating: -1, at: hourAgo }],
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
            agentId: 'ranch',
            day: today,
            model: 'claude-sonnet-4-6',
            input: 900,
            output: 90,
            calls: 36,
          },
        ],
        loadDays: [{ agentId: 'ranch', day: today, refused: 5 }],
        incidents: [
          {
            number: 8,
            agentId: 'ranch',
            agentName: 'Ranch',
            reason: 'OOMKilled',
            openedAt: hourAgo,
            closedAt: null,
          },
        ],
      },
      access,
    );
    const tool = new StatsTool({} as PersonalStatsService, service);
    type Answer = {
      reach: { limited: boolean; agents: number; ownerOnly: string[] };
      board: { calls: { value: number }; people: { value: number } };
      agents: { agentId: string }[];
      health: {
        incidents: { number: number }[];
        refusals: { agentId: string; refused: number }[];
      };
      quality: { agentId: string }[];
      channels: { channel: string; conversations: number }[];
    };
    const asked = async (request: Request) =>
      JSON.parse(
        textOf(
          await tool.getInstallationStats({ period: 7 }, undefined, request),
        ),
      ) as Answer;

    const mine = await asked(answering(ADMIN.role, ADMIN.id));

    expect(mine.reach).toEqual({
      limited: false,
      agents: 2,
      ownerOnly: ['Ranch'],
    });
    expect(mine.quality.map((q) => q.agentId)).toEqual(['a1']);
    expect(mine.channels).toEqual([{ channel: 'console', conversations: 1 }]);
    expect(mine.board.people.value).toBe(1);
    // Operations: the same agents as the usage overview shows this Admin.
    expect(mine.board.calls.value).toBe(40);
    expect(mine.agents.map((a) => a.agentId)).toEqual(['ranch', 'a1']);
    expect(mine.health.refusals).toEqual([
      { agentId: 'ranch', name: 'Ranch', refused: 5 },
    ]);
    expect(mine.health.incidents.map((i) => i.number)).toEqual([8]);

    // The Owner, and the assistant on its own schedule: everything, and
    // nothing to explain.
    for (const request of [
      answering(OWNER.role, OWNER.id),
      asTrustedAgent(ranchAgent()),
    ]) {
      const whole = await asked(request);
      expect(whole.reach).toEqual({
        limited: false,
        agents: 2,
        ownerOnly: [],
      });
      expect(whole.quality.map((q) => q.agentId).sort()).toEqual([
        'a1',
        'ranch',
      ]);
      expect(whole.channels).toEqual([
        { channel: 'console', conversations: 1 },
        { channel: 'telegram', conversations: 1 },
      ]);
      expect(whole.board.people.value).toBe(2);
      expect(whole.board.calls.value).toBe(40);
    }
  });
});

describe('get_installation_stats: what it asks for and what it answers', () => {
  it('answers with what the service answered, and nothing else', async () => {
    const { tool, installationAnswer } = recording();

    const result = await tool.getInstallationStats(
      {},
      undefined,
      answering(UserRoleTypes.Admin, 'admin-3'),
    );

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(textOf(result))).toEqual(
      JSON.parse(JSON.stringify(installationAnswer)),
    );
  });

  it('asks for 30 days unless told, and passes the period on', async () => {
    const { tool, forCaller } = recording();
    const request = () => answering(UserRoleTypes.Admin, 'admin-3');

    await tool.getInstallationStats({}, undefined, request());
    await tool.getInstallationStats({ period: 7 }, undefined, request());
    await tool.getInstallationStats({ period: 90 }, undefined, request());
    // A model writes null for "not given".
    await tool.getInstallationStats({ period: null }, undefined, request());

    expect(forCaller.mock.calls.map(([, question]) => question)).toEqual([
      { period: 30 },
      { period: 7 },
      { period: 90 },
      { period: 30 },
    ]);
  });

  // Nothing checks a tool's arguments against its schema before the call:
  // what the model wrote is what arrives.
  it('refuses a period that is not 7, 30 or 90, says which are, and reads nothing', async () => {
    const { tool, forCaller } = recording();

    for (const period of [14, 0, 180, 365, '30', 'quarter', [7]]) {
      const result = await tool.getInstallationStats(
        { period } as never,
        undefined,
        answering(UserRoleTypes.Admin, 'admin-3'),
      );
      expect([period, result.isError]).toEqual([period, true]);
      expect(textOf(result)).toContain('7, 30 or 90');
      expect(textOf(result)).toContain('get_installation_stats');
    }
    expect(forCaller).not.toHaveBeenCalled();
  });

  it('checks who is asking before it looks at the arguments', async () => {
    const { tool } = recording();

    await expect(
      tool.getInstallationStats(
        { period: 14 } as never,
        undefined,
        answering(UserRoleTypes.User, 'user-7'),
      ),
    ).rejects.toThrow(OPERATOR_REFUSAL);
  });
});
