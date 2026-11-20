import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { asGuest, asPerson, asTrustedAgent } from '#/mcp/testing';
import { audienceAllows, type ToolResult } from '#/mcp/tooling';
import {
  MCP_TOOL_METADATA_KEY,
  toolAudienceOf,
  type ToolMetadata,
} from '#/mcp/decorators';
import { UserRoleTypes } from '#/user/user/domain';
import { AssistantAccessTool } from './assistantAccess.tool';
import { AssistantAccessService } from './domain/assistantAccess.service';
import { MY_ASSISTANT_ACCESS_TOOL } from './domain/assistantToolPolicy.service';
import type {
  AssistantRole,
  IAssistantAccountData,
  IAssistantSettingData,
} from './domain/assistantAccess.types';

/**
 * The assistant's settings from the chat (CLEAN-240): the same service as
 * the routes, so the same rules. What is the tools' own: who is listed them,
 * the "who loses what" before a yes, and the level definitions the assistant
 * explains from.
 */

const TOOLS: [string, string, 'read' | 'write', string, boolean?][] = [
  ['list_agents', 'agents', 'read', 'reader'],
  ['pin_agent', 'agents', 'write', 'person'],
  ['restart_agent', 'agents', 'write', 'manage-agent'],
  ['delete_agent', 'agents', 'write', 'manage-agent', true],
  ['list_knowledges', 'knowledge', 'read', 'admin'],
  ['create_knowledge', 'knowledge', 'write', 'admin'],
  ['list_users', 'users_keys', 'read', 'admin'],
  ['create_user', 'users_keys', 'write', 'admin'],
  ['delete_user', 'users_keys', 'write', 'owner', true],
  ['query_knowledge', 'knowledge', 'read', 'everyone'],
];

const OWNER = {
  id: 'owner',
  role: UserRoleTypes.Owner,
  name: 'Olga',
  email: 'o@x',
};
const ADMIN = {
  id: 'admin-1',
  role: UserRoleTypes.Admin,
  name: 'Ann',
  email: 'a@x',
};
const ADMIN_2 = {
  id: 'admin-2',
  role: UserRoleTypes.Admin,
  name: 'Abe',
  email: 'b@x',
};
const USER = {
  id: 'user-1',
  role: UserRoleTypes.User,
  name: 'Uma',
  email: 'u@x',
};
const USER_2 = {
  id: 'user-2',
  role: UserRoleTypes.User,
  name: 'Udo',
  email: 'v@x',
};
const PEOPLE = [OWNER, ADMIN, ADMIN_2, USER, USER_2];

function harness(tools = TOOLS) {
  const roles = new Map<AssistantRole, IAssistantSettingData>();
  const accounts = new Map<string, IAssistantAccountData>();
  const gateway = {
    findRole: async (role: AssistantRole) => roles.get(role) ?? null,
    saveRole: async (role: AssistantRole, data: IAssistantSettingData) => {
      const row = { ...data, updatedAt: new Date() };
      roles.set(role, row);
      return row;
    },
    findAccount: async (id: string) => accounts.get(id) ?? null,
    listAccounts: async () => [...accounts.values()],
    saveAccount: async (userId: string, data: IAssistantSettingData) => {
      const row = { userId, ...data, updatedAt: new Date() };
      accounts.set(userId, row);
      return row;
    },
    deleteAccount: async (id: string) => accounts.delete(id),
  };
  const users = {
    findById: async (id: string) => PEOPLE.find((p) => p.id === id) ?? null,
    findAll: async () => PEOPLE,
  };
  const service = new AssistantAccessService(
    gateway as never,
    users as never,
    { findAdmin: async () => ({ id: 'assistant', name: 'Rancher' }) } as never,
    {
      getTools: () =>
        tools.map(([name, topic, effect, audience, destructive]) => ({
          metadata: {
            name,
            title: `Title of ${name}`,
            topic,
            effect,
            destructive,
          },
          audience,
        })),
    } as never,
  );
  return { tool: new AssistantAccessTool(service), service, roles, accounts };
}

/** The assistant's own request: its token carries Owner. */
const ranch = (): Request =>
  ({
    user: { sub: 'agent:assistant', email: '', roles: [UserRoleTypes.Owner] },
  }) as unknown as Request;
const forPerson = (p: { id: string; role: UserRoleTypes }) =>
  asPerson(ranch(), p.role, p.id);

const json = (result: ToolResult) =>
  JSON.parse(result.content[0].text) as Record<string, any>;
const text = (result: ToolResult) => result.content[0].text;

const methodOf = (name: keyof AssistantAccessTool): unknown =>
  Object.getOwnPropertyDescriptor(AssistantAccessTool.prototype, name)?.value;
const audienceOf = (name: keyof AssistantAccessTool) =>
  toolAudienceOf(AssistantAccessTool, methodOf(name));
const metadataOf = (name: keyof AssistantAccessTool) =>
  Reflect.getMetadata(
    MCP_TOOL_METADATA_KEY,
    methodOf(name) as object,
  ) as ToolMetadata;

describe('the assistant-access tools: who is listed what', () => {
  it('the overview and the role setting are the Owner’s', () => {
    expect(audienceOf('getAssistantAccess')).toBe('owner');
    expect(audienceOf('setAssistantRoleAccess')).toBe('owner');
    expect(audienceAllows('owner', forPerson(ADMIN))).toBe(false);
    expect(audienceAllows('owner', forPerson(OWNER))).toBe(true);
    expect(audienceAllows('owner', asTrustedAgent(ranch()))).toBe(true);
  });

  it('an account’s setting is an administrator’s', () => {
    for (const name of [
      'getUserAssistantAccess',
      'setUserAssistantAccess',
      'resetUserAssistantAccess',
    ] as const) {
      expect(audienceOf(name)).toBe('admin');
    }
    expect(audienceAllows('admin', forPerson(USER))).toBe(false);
  });

  it('everybody signed in may ask about themselves, and nobody else may', () => {
    expect(audienceOf('getMyAssistantAccess')).toBe('person');
    expect(audienceAllows('person', forPerson(USER))).toBe(true);
    expect(audienceAllows('person', asGuest(ranch()))).toBe(false);
    expect(metadataOf('getMyAssistantAccess').name).toBe(
      MY_ASSISTANT_ACCESS_TOOL,
    );
  });

  it('what changes a setting says so, and asks first', () => {
    for (const name of [
      'setAssistantRoleAccess',
      'setUserAssistantAccess',
    ] as const) {
      expect(metadataOf(name).effect).toBe('write');
      expect(metadataOf(name).destructive).toBe(true);
    }
    for (const name of [
      'getAssistantAccess',
      'getUserAssistantAccess',
      'getMyAssistantAccess',
    ] as const) {
      expect(metadataOf(name).effect).toBe('read');
    }
  });

  it('refuses a caller its audience does not admit, even when called', async () => {
    const { tool } = harness();
    await expect(
      tool.getAssistantAccess({}, null, forPerson(ADMIN)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      tool.setUserAssistantAccess(
        { userId: USER.id, level: 'basic' },
        null,
        forPerson(USER),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      tool.getMyAssistantAccess({}, null, asGuest(ranch())),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('get_assistant_access', () => {
  it('says what each role gets, who differs, and what the levels are', async () => {
    const { tool, service } = harness();
    await service.setAccount(
      { kind: 'person', userId: OWNER.id, role: OWNER.role },
      ADMIN.id,
      { level: 'basic' },
    );
    const out = json(await tool.getAssistantAccess({}, null, forPerson(OWNER)));

    expect(out.roles.Admin).toMatchObject({
      enabled: true,
      level: 'full',
      accounts: 1,
    });
    expect(out.roles.User).toMatchObject({
      enabled: true,
      level: 'basic',
      accounts: 2,
    });
    expect(out.exceptions).toEqual([
      expect.objectContaining({
        name: 'Ann',
        role: 'Admin',
        level: 'basic',
        enabled: true,
      }),
    ]);
    expect(out.levels.Admin.map((l: any) => l.key)).toEqual([
      'basic',
      'standard',
      'full',
    ]);
    expect(out.levels.User.map((l: any) => l.key)).toEqual([
      'basic',
      'standard',
      'full',
    ]);
    expect(out.levels.Admin[0].summary).toMatch(/See and ask/);
  });

  it('the level definitions follow the tools', async () => {
    const before = json(
      await harness().tool.getAssistantAccess({}, null, forPerson(OWNER)),
    );
    const after = json(
      await harness([
        ...TOOLS,
        ['archive_agent', 'agents', 'write', 'manage-agent'],
      ]).tool.getAssistantAccess({}, null, forPerson(OWNER)),
    );
    const agents = (out: any, level: number) =>
      out.levels.Admin[level].areas.find((a: any) => a.key === 'agents');
    expect(agents(before, 1)).toMatchObject({ offered: 4, available: 4 });
    expect(agents(after, 1)).toMatchObject({ offered: 5, available: 5 });
    expect(agents(after, 0)).toMatchObject({ offered: 2, available: 5 });
  });
});

describe('set_assistant_role_access', () => {
  it('narrowing says who loses what and changes nothing without a yes', async () => {
    const { tool, roles } = harness();
    const result = await tool.setAssistantRoleAccess(
      { role: 'Admin', level: 'basic' },
      null,
      forPerson(OWNER),
    );
    const out = json(result);
    expect(out.changed).toBe(false);
    expect(out.wouldLose).toMatchObject({ accounts: 2, abilities: 4 });
    expect(out.wouldLose.byArea).toEqual(
      expect.arrayContaining([
        { area: 'Agents', abilities: 2 },
        { area: 'Knowledge', abilities: 1 },
        { area: 'Users & API keys', abilities: 1 },
      ]),
    );
    expect(text(result)).toMatch(/confirm: true/);
    expect(roles.size).toBe(0);
  });

  it('with a yes it is saved', async () => {
    const { tool, roles } = harness();
    const out = json(
      await tool.setAssistantRoleAccess(
        { role: 'Admin', level: 'basic', confirm: true },
        null,
        forPerson(OWNER),
      ),
    );
    expect(out.changed).toBe(true);
    expect(out.role).toMatchObject({ level: 'basic', offered: 4 });
    expect(roles.get(UserRoleTypes.Admin as AssistantRole)?.level).toBe(
      'basic',
    );
  });

  it('widening needs no yes', async () => {
    const { tool, roles } = harness();
    const out = json(
      await tool.setAssistantRoleAccess(
        { role: 'User', level: 'standard' },
        null,
        forPerson(OWNER),
      ),
    );
    expect(out.changed).toBe(true);
    expect(roles.get(UserRoleTypes.User as AssistantRole)?.level).toBe(
      'standard',
    );
  });

  it('switching off is narrowing', async () => {
    const { tool, roles } = harness();
    const out = json(
      await tool.setAssistantRoleAccess(
        { role: 'User', enabled: false },
        null,
        forPerson(OWNER),
      ),
    );
    expect(out.changed).toBe(false);
    expect(out.wouldLose).toMatchObject({ accounts: 2, abilities: 2 });
    expect(roles.size).toBe(0);
  });

  it('answers a refusal in words', async () => {
    const { tool } = harness();
    const result = await tool.setAssistantRoleAccess(
      { role: 'User', level: 'custom', on: ['create_user'], confirm: true },
      null,
      forPerson(OWNER),
    );
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/above what this role can do/);
    expect(text(result)).toMatch(/create_user/);
  });
});

describe('an account’s setting from the chat', () => {
  it('reads one account, and where its setting comes from', async () => {
    const { tool } = harness();
    const out = json(
      await tool.getUserAssistantAccess(
        { userId: USER.id },
        null,
        forPerson(OWNER),
      ),
    );
    expect(out).toMatchObject({
      userId: USER.id,
      email: 'u@x',
      role: 'User',
      enabled: true,
      level: 'basic',
      source: 'role',
    });
  });

  it('an Admin gives a User no more than the Admin has, and is told which abilities', async () => {
    const { tool, service, accounts } = harness();
    await service.setRole(
      { kind: 'trusted' },
      UserRoleTypes.Admin as AssistantRole,
      {
        level: 'basic',
      },
    );
    const result = await tool.setUserAssistantAccess(
      { userId: USER.id, level: 'standard', confirm: true },
      null,
      forPerson(ADMIN),
    );
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/more than the assistant offers you/);
    expect(text(result)).toMatch(/restart_agent/);
    expect(accounts.size).toBe(0);
  });

  it.each([
    ['the Owner account', OWNER.id, forPerson(OWNER)],
    ['their own', ADMIN.id, forPerson(ADMIN)],
    ['another Admin', ADMIN_2.id, forPerson(ADMIN)],
  ])('refuses %s', async (_label, userId, req) => {
    const { tool, accounts } = harness();
    const result = await tool.setUserAssistantAccess(
      { userId, level: 'basic', confirm: true },
      null,
      req,
    );
    expect(result.isError).toBe(true);
    expect(accounts.size).toBe(0);
  });

  it('an unknown account is answered with where to find the id', async () => {
    const { tool } = harness();
    const result = await tool.getUserAssistantAccess(
      { userId: 'nobody' },
      null,
      forPerson(OWNER),
    );
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/list_users/);
  });

  it('taking the assistant away asks first; giving more does not', async () => {
    const { tool, accounts } = harness();
    const dry = json(
      await tool.setUserAssistantAccess(
        { userId: ADMIN.id, enabled: false },
        null,
        forPerson(OWNER),
      ),
    );
    expect(dry.changed).toBe(false);
    expect(dry.wouldLose).toMatchObject({ accounts: 1, abilities: 8 });
    expect(accounts.size).toBe(0);

    const wider = json(
      await tool.setUserAssistantAccess(
        { userId: USER.id, level: 'standard' },
        null,
        forPerson(OWNER),
      ),
    );
    expect(wider.changed).toBe(true);
  });

  it('reset returns the account to its role', async () => {
    const { tool, accounts } = harness();
    await tool.setUserAssistantAccess(
      { userId: USER.id, level: 'standard' },
      null,
      forPerson(OWNER),
    );
    const out = json(
      await tool.resetUserAssistantAccess(
        { userId: USER.id },
        null,
        forPerson(OWNER),
      ),
    );
    expect(out.access).toMatchObject({ source: 'role', level: 'basic' });
    expect(accounts.size).toBe(0);
  });

  it('the assistant acting for itself acts as the Owner', async () => {
    const { tool } = harness();
    const out = json(
      await tool.setUserAssistantAccess(
        { userId: ADMIN.id, level: 'standard', confirm: true },
        null,
        asTrustedAgent(ranch()),
      ),
    );
    expect(out.changed).toBe(true);
  });
});

describe('get_my_assistant_access', () => {
  it('tells a person their level, their areas and what was left out for them', async () => {
    const { tool, service } = harness();
    await service.setRole(
      { kind: 'trusted' },
      UserRoleTypes.Admin as AssistantRole,
      {
        level: 'basic',
      },
    );
    const out = json(
      await tool.getMyAssistantAccess({}, null, forPerson(ADMIN)),
    );

    expect(out).toMatchObject({ enabled: true, level: 'basic' });
    expect(out.notIncluded.map((a: any) => a.title).sort()).toEqual([
      'Title of create_knowledge',
      'Title of create_user',
      'Title of delete_agent',
      'Title of restart_agent',
    ]);
    expect(out.whoDecides).toMatch(/Owner/);
    // Their own role only, and only what that role's ceiling shows.
    expect(out.levels.map((l: any) => l.key)).toEqual([
      'basic',
      'standard',
      'full',
    ]);
  });

  it('a User sees no area only Admins have, in their level or in the definitions', async () => {
    const { tool } = harness();
    const out = json(
      await tool.getMyAssistantAccess({}, null, forPerson(USER)),
    );
    const areas = new Set<string>([
      ...out.areas.map((a: any) => a.key),
      ...out.levels.flatMap((l: any) => l.areas.map((a: any) => a.key)),
      ...out.notIncluded.map((a: any) => a.area),
    ]);
    expect([...areas]).toEqual(['agents']);
  });

  it('says nothing about anybody else', async () => {
    const { tool, service } = harness();
    await service.setAccount({ kind: 'trusted' }, ADMIN_2.id, {
      level: 'basic',
    });
    const raw = text(
      await tool.getMyAssistantAccess({}, null, forPerson(ADMIN)),
    );
    for (const other of [ADMIN_2, USER, OWNER]) {
      expect(raw).not.toContain(other.id);
      expect(raw).not.toContain(other.email);
      expect(raw).not.toContain(other.name);
    }
    expect(raw).not.toMatch(/exceptions|accounts/);
  });

  it('is there with nothing else on', async () => {
    const { tool, service } = harness();
    await service.setRole(
      { kind: 'trusted' },
      UserRoleTypes.User as AssistantRole,
      {
        level: 'custom',
        on: [],
      },
    );
    const out = json(
      await tool.getMyAssistantAccess({}, null, forPerson(USER)),
    );
    expect(out).toMatchObject({ enabled: true, level: 'custom' });
    expect(out.notIncluded.length).toBeGreaterThan(0);
  });

  it('the Owner has everything', async () => {
    const { tool } = harness();
    const out = json(
      await tool.getMyAssistantAccess({}, null, forPerson(OWNER)),
    );
    expect(out).toMatchObject({ level: 'owner', notIncluded: [] });
  });
});
