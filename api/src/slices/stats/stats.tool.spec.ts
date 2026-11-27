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
import { audienceAllows } from '#/mcp/tooling';
import { UserRoleTypes } from '#/user/user/domain';
import {
  IPersonalStats,
  IStatsQuestion,
  IStatsViewer,
  PersonalStatsService,
} from './domain';
import { statsHarness } from './domain/__fixtures__/personalStats';
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
  const tool = new StatsTool({ forPerson } as unknown as PersonalStatsService);
  return { tool, forPerson, answer };
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
      const viaTool = await new StatsTool(service).getMyStats(
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
