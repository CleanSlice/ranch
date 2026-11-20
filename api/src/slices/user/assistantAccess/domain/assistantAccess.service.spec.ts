import { UserRoleTypes } from '#/user/user/domain/user.types';
import type { IUserGateway } from '#/user/user/domain';
import type { IAgentGateway } from '#/agent/agent/domain';
import type { McpRegistryService } from '#/mcp/services/mcp-registry.service';
import { AssistantAccessService } from './assistantAccess.service';
import {
  IAssistantAccessGateway,
  IAssistantSettingWrite,
} from './assistantAccess.gateway';
import {
  AssistantAccessError,
  AssistantAccessErrorCodes,
  AssistantRole,
  IAssistantAccountData,
  IAssistantEditor,
  IAssistantSettingData,
} from './assistantAccess.types';

// A small installation: the tools are enough to tell the levels and the two
// role ceilings apart.
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
  ['ask_agent', 'peers', 'write', 'agent'],
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

const asOwner: IAssistantEditor = {
  kind: 'person',
  userId: 'owner',
  role: UserRoleTypes.Owner,
};
const asAdmin: IAssistantEditor = {
  kind: 'person',
  userId: 'admin-1',
  role: UserRoleTypes.Admin,
};
const asUser: IAssistantEditor = {
  kind: 'person',
  userId: 'user-1',
  role: UserRoleTypes.User,
};

function harness(tools = TOOLS) {
  const roles = new Map<AssistantRole, IAssistantSettingData>();
  const accounts = new Map<string, IAssistantAccountData>();
  let tick = 0;
  const stamp = () => new Date(Date.UTC(2026, 10, 20, 12, 0, tick++));

  const spies = {
    findRole: jest.fn(async (role: AssistantRole) => roles.get(role) ?? null),
    saveRole: jest.fn(
      async (role: AssistantRole, data: IAssistantSettingWrite) => {
        const row = { ...data, updatedAt: stamp() };
        roles.set(role, row);
        return row;
      },
    ),
    findAccount: jest.fn(async (id: string) => accounts.get(id) ?? null),
    listAccounts: jest.fn(async () => [...accounts.values()]),
    saveAccount: jest.fn(
      async (userId: string, data: IAssistantSettingWrite) => {
        const row = { userId, ...data, updatedAt: stamp() };
        accounts.set(userId, row);
        return row;
      },
    ),
    deleteAccount: jest.fn(async (id: string) => accounts.delete(id)),
  };
  const gateway = spies as unknown as IAssistantAccessGateway;

  const people = [OWNER, ADMIN, ADMIN_2, USER, USER_2];
  const users = {
    findById: jest.fn(
      async (id: string) => people.find((p) => p.id === id) ?? null,
    ),
    findAll: jest.fn(async () => people),
  } as unknown as IUserGateway;

  const createdBy: (string | null)[] = [];
  const agents = {
    findAdmin: jest.fn(async () => ({ id: 'assistant', name: 'Rancher' })),
    findAll: jest.fn(async () =>
      createdBy.map((createdById, i) => ({ id: `agent-${i}`, createdById })),
    ),
  } as unknown as IAgentGateway;

  const registry = {
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
  } as unknown as McpRegistryService;

  const service = new AssistantAccessService(gateway, users, agents, registry);
  return { service, roles, accounts, gateway, spies, createdBy };
}

const person = (p: { id: string; role: UserRoleTypes }) => ({
  kind: 'person' as const,
  userId: p.id,
  role: p.role,
});

const names = (set: ReadonlySet<string> | null) =>
  set ? [...set].sort() : null;

async function refusal(
  run: () => Promise<unknown>,
): Promise<AssistantAccessError> {
  try {
    await run();
  } catch (e) {
    return e as AssistantAccessError;
  }
  throw new Error('expected a refusal');
}

describe('what a person gets with nothing configured', () => {
  it('an Admin has the assistant with everything an Admin can do', async () => {
    const { service } = harness();
    const grant = await service.grantFor(person(ADMIN));
    expect(grant.enabled).toBe(true);
    expect(grant.level).toBe('full');
    expect(names(grant.names)).toEqual([
      'create_knowledge',
      'create_user',
      'delete_agent',
      'list_agents',
      'list_knowledges',
      'list_users',
      'pin_agent',
      'restart_agent',
    ]);
  });

  it('a User has it to see and ask', async () => {
    const { service } = harness();
    const grant = await service.grantFor(person(USER));
    expect(grant.enabled).toBe(true);
    expect(grant.level).toBe('basic');
    expect(names(grant.names)).toEqual(['list_agents', 'pin_agent']);
  });

  it('no setting applies to the Owner, a trusted party or a guest', async () => {
    const { service, spies } = harness();
    for (const party of [
      person(OWNER),
      { kind: 'trusted' as const },
      { kind: 'guest' as const },
    ]) {
      const grant = await service.grantFor(party);
      expect(grant.enabled).toBe(true);
      expect(grant.names).toBeNull();
    }
    expect((await service.grantFor(person(OWNER))).level).toBe('owner');
    expect(spies.findAccount).not.toHaveBeenCalled();
    expect(spies.findRole).not.toHaveBeenCalled();
  });

  it('never grants a name the role cannot have, whatever the level', async () => {
    const { service } = harness();
    await service.setRole(asOwner, UserRoleTypes.User, { level: 'full' });
    const grant = await service.grantFor(person(USER));
    // Full for a User is the manage-agent work, not an Admin's.
    expect(names(grant.names)).toEqual([
      'delete_agent',
      'list_agents',
      'pin_agent',
      'restart_agent',
    ]);
  });
});

describe('role settings', () => {
  it('a role row replaces the default for everyone of that role', async () => {
    const { service } = harness();
    await service.setRole(asOwner, UserRoleTypes.Admin, { level: 'standard' });
    const grant = await service.grantFor(person(ADMIN_2));
    expect(grant.level).toBe('standard');
    expect(grant.names?.has('create_knowledge')).toBe(true);
    expect(grant.names?.has('create_user')).toBe(false);
  });

  it('off is off for the role', async () => {
    const { service } = harness();
    await service.setRole(asOwner, UserRoleTypes.User, { enabled: false });
    expect((await service.grantFor(person(USER))).enabled).toBe(false);
    expect((await service.grantFor(person(ADMIN))).enabled).toBe(true);
  });

  it('keeps what was not mentioned', async () => {
    const { service } = harness();
    await service.setRole(asOwner, UserRoleTypes.Admin, { level: 'standard' });
    await service.setRole(asOwner, UserRoleTypes.Admin, { enabled: false });
    const view = await service.roleView(UserRoleTypes.Admin);
    expect(view.enabled).toBe(false);
    expect(view.level).toBe('standard');
  });

  it('only the Owner, or a trusted party, sets a role', async () => {
    const { service } = harness();
    for (const editor of [asAdmin, asUser]) {
      const err = await refusal(() =>
        service.setRole(editor, UserRoleTypes.User, { level: 'standard' }),
      );
      expect(err.code).toBe(AssistantAccessErrorCodes.NotAllowed);
    }
    await expect(
      service.setRole({ kind: 'trusted' }, UserRoleTypes.User, {
        level: 'standard',
      }),
    ).resolves.toBeDefined();
  });

  it('there is no setting for the Owner role', async () => {
    const { service } = harness();
    const err = await refusal(() =>
      service.setRole(asOwner, UserRoleTypes.Owner as never, {
        level: 'basic',
      }),
    );
    expect(err.code).toBe(AssistantAccessErrorCodes.BadRole);
  });

  it('refuses a change made on a stale version', async () => {
    const { service } = harness();
    const first = await service.setRole(asOwner, UserRoleTypes.Admin, {
      level: 'standard',
    });
    await service.setRole(asOwner, UserRoleTypes.Admin, {
      level: 'basic',
      version: first.version,
    });
    const err = await refusal(() =>
      service.setRole(asOwner, UserRoleTypes.Admin, {
        level: 'full',
        version: first.version,
      }),
    );
    expect(err.code).toBe(AssistantAccessErrorCodes.Stale);
  });

  it('reports offered and available within the role, and who follows it', async () => {
    const { service } = harness();
    await service.setRole(asOwner, UserRoleTypes.Admin, { level: 'standard' });
    await service.setAccount(asOwner, ADMIN.id, { level: 'basic' });
    const view = await service.roleView(UserRoleTypes.Admin);
    expect(view).toMatchObject({ source: 'role', offered: 7, available: 8 });
    const overview = await service.overview(asOwner);
    expect(overview.roles.Admin.accounts).toBe(1);
    expect(overview.roles.User.accounts).toBe(2);
  });
});

describe('an account that differs from its role', () => {
  it('wins over the role in both directions', async () => {
    const { service } = harness();
    await service.setRole(asOwner, UserRoleTypes.Admin, { level: 'standard' });
    await service.setAccount(asOwner, ADMIN.id, { level: 'full' });
    await service.setAccount(asOwner, ADMIN_2.id, { enabled: false });

    expect(
      (await service.grantFor(person(ADMIN))).names?.has('create_user'),
    ).toBe(true);
    expect((await service.grantFor(person(ADMIN_2))).enabled).toBe(false);

    // The role moves; the exception stays.
    await service.setRole(asOwner, UserRoleTypes.Admin, { level: 'basic' });
    expect((await service.grantFor(person(ADMIN))).level).toBe('full');
  });

  it('starts from the role when only one thing is changed', async () => {
    const { service } = harness();
    await service.setRole(asOwner, UserRoleTypes.Admin, { level: 'standard' });
    await service.setAccount(asOwner, ADMIN.id, { enabled: false });
    const view = await service.accountView(asOwner, ADMIN.id);
    expect(view).toMatchObject({
      enabled: false,
      level: 'standard',
      source: 'account',
    });
  });

  it('says where the setting comes from', async () => {
    const { service } = harness();
    expect((await service.accountView(asOwner, ADMIN.id)).source).toBe('role');
    await service.setAccount(asOwner, ADMIN.id, { level: 'basic' });
    expect((await service.accountView(asOwner, ADMIN.id)).source).toBe(
      'account',
    );
    expect((await service.accountView(asOwner, OWNER.id)).source).toBe('owner');
  });

  it('reset drops the exception, and is fine with nothing to drop', async () => {
    const { service } = harness();
    await service.setAccount(asOwner, ADMIN.id, { level: 'basic' });
    await service.resetAccount(asOwner, ADMIN.id);
    expect((await service.grantFor(person(ADMIN))).level).toBe('full');
    await expect(
      service.resetAccount(asOwner, ADMIN.id),
    ).resolves.toBeDefined();
  });

  it('goes with the account', async () => {
    const { service, accounts } = harness();
    await service.setAccount(asOwner, USER.id, { enabled: false });
    await service.removeUser(USER.id);
    expect(accounts.has(USER.id)).toBe(false);
  });

  describe('who may change it', () => {
    it.each([
      ['the Owner account', asOwner, OWNER.id],
      ['their own account', asAdmin, ADMIN.id],
      ['another Admin, as an Admin', asAdmin, ADMIN_2.id],
      ['anybody, as a User', asUser, USER_2.id],
    ])('nobody changes %s', async (_label, editor, targetId) => {
      const { service, accounts } = harness();
      const err = await refusal(() =>
        service.setAccount(editor, targetId, { level: 'basic' }),
      );
      expect(err.code).toBe(AssistantAccessErrorCodes.NotAllowed);
      expect(accounts.size).toBe(0);
    });

    it('an unknown account is not found', async () => {
      const { service } = harness();
      const err = await refusal(() =>
        service.setAccount(asOwner, 'nobody', { level: 'basic' }),
      );
      expect(err.code).toBe(AssistantAccessErrorCodes.UserNotFound);
    });

    it('an Admin gives a User no more than the Admin has', async () => {
      const { service, accounts } = harness();
      // Admins on Basic: an Admin has no agent management through the assistant.
      await service.setRole(asOwner, UserRoleTypes.Admin, { level: 'basic' });

      const err = await refusal(() =>
        service.setAccount(asAdmin, USER.id, { level: 'standard' }),
      );
      expect(err.code).toBe(AssistantAccessErrorCodes.AboveYourOwn);
      expect(err.names).toEqual(['delete_agent', 'restart_agent']);
      expect(accounts.size).toBe(0);

      await expect(
        service.setAccount(asAdmin, USER.id, { level: 'basic' }),
      ).resolves.toMatchObject({ level: 'basic', source: 'account' });
      await expect(
        service.setAccount(asAdmin, USER.id, { enabled: false }),
      ).resolves.toBeDefined();
    });

    it('tells an Admin editor what their own ceiling is, and nobody else', async () => {
      const { service } = harness();
      await service.setRole(asOwner, UserRoleTypes.Admin, { level: 'basic' });
      const forAdmin = await service.accountView(asAdmin, USER.id);
      expect(forAdmin.ceiling?.sort()).toEqual([
        'list_agents',
        'list_knowledges',
        'list_users',
        'pin_agent',
      ]);
      expect(forAdmin.editable).toBe(true);
      expect((await service.accountView(asOwner, USER.id)).ceiling).toBeNull();
      expect((await service.accountView(asOwner, OWNER.id)).editable).toBe(
        false,
      );
    });
  });
});

describe('a custom pick', () => {
  it('offers exactly the names picked, within the role', async () => {
    const { service } = harness();
    await service.setRole(asOwner, UserRoleTypes.Admin, {
      level: 'custom',
      on: ['restart_agent', 'list_agents', 'list_agents'],
    });
    const grant = await service.grantFor(person(ADMIN));
    expect(grant.level).toBe('custom');
    expect(names(grant.names)).toEqual(['list_agents', 'restart_agent']);
  });

  it('refuses a name the assistant does not have, or does not govern', async () => {
    const { service } = harness();
    for (const on of [['fly_to_moon'], ['query_knowledge'], ['ask_agent']]) {
      const err = await refusal(() =>
        service.setRole(asOwner, UserRoleTypes.Admin, { level: 'custom', on }),
      );
      expect(err.code).toBe(AssistantAccessErrorCodes.UnknownAbility);
      expect(err.names).toEqual(on);
    }
  });

  it('refuses a name above the role, rather than storing what cannot apply', async () => {
    const { service, roles } = harness();
    const err = await refusal(() =>
      service.setRole(asOwner, UserRoleTypes.User, {
        level: 'custom',
        on: ['list_agents', 'create_user', 'delete_user'],
      }),
    );
    expect(err.code).toBe(AssistantAccessErrorCodes.AboveRole);
    expect(err.names).toEqual(['create_user', 'delete_user']);
    expect(roles.size).toBe(0);
  });

  it('stores the pick sorted, with every governed name it knew', async () => {
    const { service, roles } = harness();
    await service.setRole(asOwner, UserRoleTypes.Admin, {
      level: 'custom',
      on: ['restart_agent', 'list_agents'],
    });
    const stored = roles.get(UserRoleTypes.Admin)!.custom!;
    expect(stored.on).toEqual(['list_agents', 'restart_agent']);
    expect(stored.known).toEqual(
      TOOLS.filter(([, , , a]) => a !== 'everyone' && a !== 'agent')
        .map(([n]) => n)
        .sort(),
    );
  });

  it('says when it equals a level', async () => {
    const { service } = harness();
    const view = await service.setRole(asOwner, UserRoleTypes.User, {
      level: 'custom',
      on: ['list_agents', 'pin_agent'],
    });
    expect(view.level).toBe('custom');
    expect(view.matchesLevel).toBe('basic');
  });

  it('a tool that appears later is off, and reported as new', async () => {
    const before = harness();
    await before.service.setRole(asOwner, UserRoleTypes.Admin, {
      level: 'custom',
      on: ['list_agents'],
    });
    const stored = before.roles.get(UserRoleTypes.Admin)!;

    const after = harness([
      ...TOOLS,
      ['list_backups', 'platform', 'read', 'admin'],
    ]);
    after.roles.set(UserRoleTypes.Admin, stored);
    const grant = await after.service.grantFor(person(ADMIN));
    expect(grant.names?.has('list_backups')).toBe(false);
    expect((await after.service.rolePick(UserRoleTypes.Admin))?.new).toEqual([
      'list_backups',
    ]);
  });

  it('a tool that is gone drops out of the pick', async () => {
    const before = harness();
    await before.service.setRole(asOwner, UserRoleTypes.Admin, {
      level: 'custom',
      on: ['list_agents', 'restart_agent'],
    });
    const stored = before.roles.get(UserRoleTypes.Admin)!;

    const after = harness(TOOLS.filter(([n]) => n !== 'restart_agent'));
    after.roles.set(UserRoleTypes.Admin, stored);
    expect(names((await after.service.grantFor(person(ADMIN))).names)).toEqual([
      'list_agents',
    ]);
    expect((await after.service.rolePick(UserRoleTypes.Admin))?.on).toEqual([
      'list_agents',
    ]);
  });

  it('going back to a level forgets the pick', async () => {
    const { service, roles } = harness();
    await service.setRole(asOwner, UserRoleTypes.Admin, {
      level: 'custom',
      on: ['list_agents'],
    });
    await service.setRole(asOwner, UserRoleTypes.Admin, { level: 'standard' });
    expect(roles.get(UserRoleTypes.Admin)!.custom).toBeNull();
  });

  it('custom with nothing picked is allowed, and offers nothing', async () => {
    const { service } = harness();
    await service.setRole(asOwner, UserRoleTypes.User, {
      level: 'custom',
      on: [],
    });
    const grant = await service.grantFor(person(USER));
    expect(grant.enabled).toBe(true);
    expect(names(grant.names)).toEqual([]);
  });
});

describe('the overview', () => {
  it('is the Owner’s', async () => {
    const { service } = harness();
    const err = await refusal(() => service.overview(asAdmin));
    expect(err.code).toBe(AssistantAccessErrorCodes.NotAllowed);
  });

  it('names the assistant and lists who differs from their role', async () => {
    const { service } = harness();
    await service.setAccount(asOwner, ADMIN.id, { level: 'standard' });
    await service.setAccount(asAdmin, USER.id, { enabled: false });
    const overview = await service.overview(asOwner);

    expect(overview.assistant).toEqual({ id: 'assistant', name: 'Rancher' });
    expect(
      overview.exceptions.map((e) => [
        e.userId,
        e.name,
        e.role,
        e.resolved.level,
        e.resolved.enabled,
        e.updatedBy,
      ]),
    ).toEqual(
      expect.arrayContaining([
        [ADMIN.id, 'Ann', UserRoleTypes.Admin, 'standard', true, 'Olga'],
        [USER.id, 'Uma', UserRoleTypes.User, 'basic', false, 'Ann'],
      ]),
    );
    expect(overview.exceptions).toHaveLength(2);
  });

  it('marks a pick that the account’s present role cuts down', async () => {
    const { service, accounts } = harness();
    // Picked while the account was an Admin; it is a User now.
    accounts.set(USER.id, {
      userId: USER.id,
      enabled: true,
      level: 'custom',
      custom: {
        on: ['list_agents', 'create_user'],
        known: ['list_agents', 'create_user'],
      },
      updatedById: OWNER.id,
      updatedAt: new Date(),
    });
    const [exception] = (await service.overview(asOwner)).exceptions;
    expect(exception.reducedByRole).toBe(true);
    expect(exception.resolved.offered).toBe(1);
    expect(names((await service.grantFor(person(USER))).names)).toEqual([
      'list_agents',
    ]);
  });

  it('drops an exception whose account is gone from the list', async () => {
    const { service, accounts } = harness();
    accounts.set('ghost', {
      userId: 'ghost',
      enabled: false,
      level: 'basic',
      custom: null,
      updatedById: null,
      updatedAt: new Date(),
    });
    expect((await service.overview(asOwner)).exceptions).toEqual([]);
  });
});

describe('the notice about Users starting on Basic', () => {
  it('counts the Users who created an agent, until the Owner decides', async () => {
    const { service, createdBy } = harness();
    createdBy.push(USER.id, USER.id, USER_2.id, ADMIN.id, null);
    expect((await service.overview(asOwner)).notice).toEqual({
      usersManagingAgents: 2,
    });
  });

  it('is gone once the Users’ setting was saved, to anything', async () => {
    const { service, createdBy } = harness();
    createdBy.push(USER.id);
    await service.setRole(asOwner, UserRoleTypes.User, { level: 'basic' });
    expect((await service.overview(asOwner)).notice).toBeNull();
  });

  it('says nothing when no User manages an agent', async () => {
    const { service, createdBy } = harness();
    createdBy.push(ADMIN.id, null);
    expect((await service.overview(asOwner)).notice).toBeNull();
  });

  it('a change to Admins is not a decision about Users', async () => {
    const { service, createdBy } = harness();
    createdBy.push(USER.id);
    await service.setRole(asOwner, UserRoleTypes.Admin, { level: 'standard' });
    expect((await service.overview(asOwner)).notice).toEqual({
      usersManagingAgents: 1,
    });
  });
});

describe('explaining the levels', () => {
  it('counts each level area by area for a role', async () => {
    const { service } = harness();
    const levels = service.levelsFor(UserRoleTypes.Admin);
    expect(levels.map((l) => l.key)).toEqual(['basic', 'standard', 'full']);
    const area = (level: number, key: string) =>
      levels[level].areas.find((a) => a.key === key);
    expect(area(0, 'agents')).toMatchObject({ offered: 2, available: 4 });
    expect(area(1, 'agents')).toMatchObject({ offered: 4, available: 4 });
    expect(area(1, 'users_keys')).toMatchObject({ offered: 1, available: 2 });
    expect(area(2, 'users_keys')).toMatchObject({ offered: 2, available: 2 });
    expect(levels[0].summary).toMatch(/See and ask/);
  });

  it('shows a User nothing of an area only Admins have', async () => {
    const { service } = harness();
    const levels = service.levelsFor(UserRoleTypes.User);
    for (const level of levels) {
      expect(level.areas.map((a) => a.key)).toEqual(['agents']);
    }
  });

  it('follows the tools: a new one changes the counts and nothing else is touched', async () => {
    const { service } = harness([
      ...TOOLS,
      ['archive_agent', 'agents', 'write', 'manage-agent'],
    ]);
    const standard = service.levelsFor(UserRoleTypes.Admin)[1];
    expect(standard.areas.find((a) => a.key === 'agents')).toMatchObject({
      offered: 5,
      available: 5,
    });
  });
});

describe('what a person is told about themselves', () => {
  it('their level, their areas, and what their role has that they were not given', async () => {
    const { service } = harness();
    await service.setRole(asOwner, UserRoleTypes.Admin, { level: 'basic' });
    const mine = await service.myAccess(person(ADMIN));
    expect(mine).toMatchObject({ enabled: true, level: 'basic' });
    expect(mine.areas.find((a) => a.key === 'agents')).toMatchObject({
      offered: 2,
      available: 4,
    });
    expect(mine.leftOut.map((a) => a.name).sort()).toEqual([
      'create_knowledge',
      'create_user',
      'delete_agent',
      'restart_agent',
    ]);
    // Never what the role could not do anyway.
    expect(mine.leftOut.map((a) => a.name)).not.toContain('delete_user');
  });

  it('the Owner has everything and nothing is left out', async () => {
    const { service } = harness();
    const mine = await service.myAccess(person(OWNER));
    expect(mine).toMatchObject({ enabled: true, level: 'owner', leftOut: [] });
  });

  it('off is off, with nothing listed', async () => {
    const { service } = harness();
    await service.setRole(asOwner, UserRoleTypes.User, { enabled: false });
    const mine = await service.myAccess(person(USER));
    expect(mine).toMatchObject({ enabled: false, areas: [], leftOut: [] });
  });
});

describe('the level the hub says beside an acting token', () => {
  it('only for the assistant', async () => {
    const { service } = harness();
    expect(
      await service.actingLevelFor('support-bot', {
        userId: ADMIN.id,
        role: 'Admin',
      }),
    ).toBeNull();
    expect(
      await service.actingLevelFor('assistant', {
        userId: ADMIN.id,
        role: 'Admin',
      }),
    ).toBe('full');
  });

  it('the Owner is the Owner, whatever is configured', async () => {
    const { service } = harness();
    expect(
      await service.actingLevelFor('assistant', {
        userId: OWNER.id,
        role: 'Owner',
      }),
    ).toBe('owner');
  });

  it('follows the role and the account’s own setting', async () => {
    const { service } = harness();
    expect(
      await service.actingLevelFor('assistant', {
        userId: USER.id,
        role: 'User',
      }),
    ).toBe('basic');
    await service.setAccount(asOwner, USER.id, { level: 'standard' });
    expect(
      await service.actingLevelFor('assistant', {
        userId: USER.id,
        role: 'User',
      }),
    ).toBe('standard');
    await service.setAccount(asOwner, USER.id, {
      level: 'custom',
      on: ['list_agents'],
    });
    expect(
      await service.actingLevelFor('assistant', {
        userId: USER.id,
        role: 'User',
      }),
    ).toBe('custom');
  });

  it('says nothing for a person it is off for, or for a role that is not a person’s', async () => {
    const { service } = harness();
    await service.setRole(asOwner, UserRoleTypes.User, { enabled: false });
    expect(
      await service.actingLevelFor('assistant', {
        userId: USER.id,
        role: 'User',
      }),
    ).toBeNull();
    expect(
      await service.actingLevelFor('assistant', { userId: 'x', role: 'Agent' }),
    ).toBeNull();
  });
});
