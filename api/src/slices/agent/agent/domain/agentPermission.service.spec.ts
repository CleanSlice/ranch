import type { ICallerParty } from '#/user/auth/domain/auth.types';
import { UserRoleTypes } from '#/user/user/domain';
import type { IAgentGateway } from './agent.gateway';
import type { IAgentData } from './agent.types';
import {
  AgentPermissionService,
  IAgentReach,
  OpenAgentReach,
  type IManagingPerson,
} from './agentPermission.service';

/**
 * Who may manage one agent (CLEAN-232, contract section 5):
 *
 *   canManage = caller is the Owner
 *            OR (not the Ranch admin agent AND caller is an Admin AND reaches)
 *            OR (not the Ranch admin agent AND caller created it AND reaches)
 */

const agent = (over: Partial<IAgentData> = {}): IAgentData =>
  ({
    id: 'agent-1',
    name: 'Support',
    isAdmin: false,
    createdById: null,
    ...over,
  }) as IAgentData;

const person = (
  role: UserRoleTypes,
  userId = `user-${role}`,
): ICallerParty => ({
  kind: 'person',
  userId,
  role,
});
const owner = person(UserRoleTypes.Owner);
const admin = person(UserRoleTypes.Admin);
const user = person(UserRoleTypes.User);
const trusted: ICallerParty = { kind: 'trusted' };
const guest: ICallerParty = { kind: 'guest' };

/** A reach that says no for the listed `userId:agentId` pairs. */
class ListedReach extends IAgentReach {
  readonly asked: string[] = [];
  constructor(private readonly refused: string[] = []) {
    super();
  }
  reaches(caller: IManagingPerson, agentId: string): Promise<boolean> {
    const key = `${caller.userId}:${agentId}`;
    this.asked.push(key);
    return Promise.resolve(!this.refused.includes(key));
  }
}

function make(
  opts: { agents?: IAgentData[]; reach?: IAgentReach; created?: string[] } = {},
) {
  const rows = opts.agents ?? [];
  const gateway = {
    findById: jest.fn((id: string) =>
      Promise.resolve(rows.find((a) => a.id === id) ?? null),
    ),
    findAdmin: jest.fn(() =>
      Promise.resolve(rows.find((a) => a.isAdmin) ?? null),
    ),
    hasCreatedBy: jest.fn((userId: string) =>
      Promise.resolve(
        (opts.created ?? []).includes(userId) ||
          rows.some((a) => a.createdById === userId),
      ),
    ),
  };
  const reach = opts.reach ?? new OpenAgentReach();
  const service = new AgentPermissionService(
    gateway as unknown as IAgentGateway,
    reach,
  );
  return { service, gateway, reach };
}

describe('canManage: line one, the Owner', () => {
  it('manages any agent, the Ranch admin agent included', async () => {
    const { service } = make();
    expect(await service.canManage(owner, agent())).toBe(true);
    expect(await service.canManage(owner, agent({ isAdmin: true }))).toBe(true);
    expect(
      await service.canManage(owner, agent({ createdById: 'someone-else' })),
    ).toBe(true);
  });

  it('is not asked whether they reach it', async () => {
    const reach = new ListedReach(['user-Owner:agent-1']);
    const { service } = make({ reach });
    expect(await service.canManage(owner, agent())).toBe(true);
    expect(reach.asked).toEqual([]);
  });
});

describe('canManage: line two, an Admin', () => {
  it('manages an ordinary agent they reach, whoever created it', async () => {
    const { service } = make();
    expect(await service.canManage(admin, agent())).toBe(true);
    expect(
      await service.canManage(admin, agent({ createdById: 'someone-else' })),
    ).toBe(true);
  });

  it('does not manage an agent they do not reach', async () => {
    const reach = new ListedReach(['user-Admin:agent-1']);
    const { service } = make({ reach });
    expect(await service.canManage(admin, agent())).toBe(false);
    expect(reach.asked).toEqual(['user-Admin:agent-1']);
    // Another agent, which they do reach.
    expect(await service.canManage(admin, agent({ id: 'agent-2' }))).toBe(true);
  });
});

describe('canManage: line three, the creator', () => {
  it('a User manages the agent they created', async () => {
    const { service } = make();
    expect(
      await service.canManage(user, agent({ createdById: 'user-User' })),
    ).toBe(true);
  });

  it('and nobody else’s', async () => {
    const { service } = make();
    expect(
      await service.canManage(user, agent({ createdById: 'user-other' })),
    ).toBe(false);
  });

  it('a creator refused by reaches does not manage their own agent', async () => {
    const reach = new ListedReach(['user-User:agent-1']);
    const { service } = make({ reach });
    expect(
      await service.canManage(user, agent({ createdById: 'user-User' })),
    ).toBe(false);
    expect(reach.asked).toEqual(['user-User:agent-1']);
  });

  it('an agent with no recorded creator belongs to no User', async () => {
    const { service } = make();
    expect(await service.canManage(user, agent({ createdById: null }))).toBe(
      false,
    );
    // An empty id on either side is not a match.
    expect(
      await service.canManage(
        person(UserRoleTypes.User, ''),
        agent({ createdById: '' }),
      ),
    ).toBe(false);
    expect(
      await service.canManage(
        person(UserRoleTypes.User, ''),
        agent({ createdById: null }),
      ),
    ).toBe(false);
  });

  it('is not asked about reach for somebody who is neither Admin nor creator', async () => {
    const reach = new ListedReach();
    const { service } = make({ reach });
    expect(await service.canManage(user, agent())).toBe(false);
    expect(reach.asked).toEqual([]);
  });
});

describe('canManage: the Ranch admin agent is the Owner’s alone', () => {
  const ranch = agent({ id: 'agent-ranch', isAdmin: true });

  it('an Admin does not manage it', async () => {
    const { service } = make();
    expect(await service.canManage(admin, ranch)).toBe(false);
  });

  it('not even the Admin who created it', async () => {
    const { service } = make();
    expect(
      await service.canManage(admin, { ...ranch, createdById: 'user-Admin' }),
    ).toBe(false);
  });

  it('nor a User who created it', async () => {
    const { service } = make();
    expect(
      await service.canManage(user, { ...ranch, createdById: 'user-User' }),
    ).toBe(false);
  });

  it('the Owner does', async () => {
    const { service } = make();
    expect(await service.canManage(owner, ranch)).toBe(true);
  });

  it('the moment an agent stops being the admin agent, the ordinary rule is back', async () => {
    const { service } = make();
    expect(await service.canManage(admin, { ...ranch, isAdmin: false })).toBe(
      true,
    );
  });
});

describe('canManage: parties that are not a person', () => {
  it('a trusted party is allowed, as before', async () => {
    const { service } = make();
    expect(await service.canManage(trusted, agent())).toBe(true);
    expect(await service.canManage(trusted, agent({ isAdmin: true }))).toBe(
      true,
    );
  });

  it('a guest never is', async () => {
    const { service } = make();
    expect(await service.canManage(guest, agent())).toBe(false);
    expect(
      await service.canManage(guest, agent({ createdById: 'anyone' })),
    ).toBe(false);
  });

  it('an agent’s own role is not a person’s', async () => {
    const { service } = make();
    expect(
      await service.canManage(person(UserRoleTypes.Agent, 'agent:x'), agent()),
    ).toBe(false);
  });
});

describe('manageable: one answer for "no such agent" and "not yours"', () => {
  const rows = [
    agent({ id: 'agent-1' }),
    agent({ id: 'agent-ranch', isAdmin: true }),
    agent({ id: 'agent-mine', createdById: 'user-User' }),
  ];

  it('hands back the agent when the caller may manage it', async () => {
    const { service } = make({ agents: rows });
    expect((await service.manageable(admin, 'agent-1'))?.id).toBe('agent-1');
    expect((await service.manageable(user, 'agent-mine'))?.id).toBe(
      'agent-mine',
    );
    expect((await service.manageable(owner, 'agent-ranch'))?.id).toBe(
      'agent-ranch',
    );
  });

  it('null for an agent that does not exist and for one out of reach, alike', async () => {
    const { service } = make({ agents: rows });
    expect(await service.manageable(admin, 'agent-nope')).toBeNull();
    expect(await service.manageable(admin, 'agent-ranch')).toBeNull();
    expect(await service.manageable(user, 'agent-1')).toBeNull();
    expect(await service.manageable(user, 'agent-nope')).toBeNull();
  });

  it('does not even look for a guest, or without an id', async () => {
    const { service, gateway } = make({ agents: rows });
    expect(await service.manageable(guest, 'agent-1')).toBeNull();
    expect(await service.manageable(owner, '')).toBeNull();
    expect(gateway.findById).not.toHaveBeenCalled();
  });
});

describe('managesAny: who is shown the manage-agent tools', () => {
  it('an Owner and an Admin, without asking the database', async () => {
    const { service, gateway } = make();
    expect(
      await service.managesAny({ userId: 'o', role: UserRoleTypes.Owner }),
    ).toBe(true);
    expect(
      await service.managesAny({ userId: 'a', role: UserRoleTypes.Admin }),
    ).toBe(true);
    expect(gateway.hasCreatedBy).not.toHaveBeenCalled();
  });

  it('a User who created an agent', async () => {
    const { service } = make({ created: ['user-1'] });
    expect(
      await service.managesAny({ userId: 'user-1', role: UserRoleTypes.User }),
    ).toBe(true);
  });

  it('not a User who created none', async () => {
    const { service } = make({ created: ['user-1'] });
    expect(
      await service.managesAny({ userId: 'user-2', role: UserRoleTypes.User }),
    ).toBe(false);
  });
});

describe('callerOfBearer: the caller behind a console request', () => {
  it('a person’s own token is that person, with their strongest role', () => {
    expect(
      AgentPermissionService.callerOfBearer({
        sub: 'user-1',
        roles: [UserRoleTypes.User, UserRoleTypes.Admin],
      }),
    ).toEqual({ kind: 'person', userId: 'user-1', role: UserRoleTypes.Admin });
  });

  it('an agent runtime’s token is a guest, though it carries Owner', () => {
    expect(
      AgentPermissionService.callerOfBearer({
        sub: 'agent:ranch',
        roles: [UserRoleTypes.Owner],
      }),
    ).toEqual({ kind: 'guest' });
  });

  it('no bearer, no subject or no person role is a guest', () => {
    expect(AgentPermissionService.callerOfBearer(undefined)).toEqual({
      kind: 'guest',
    });
    expect(
      AgentPermissionService.callerOfBearer({
        sub: '',
        roles: [UserRoleTypes.Owner],
      }),
    ).toEqual({ kind: 'guest' });
    expect(
      AgentPermissionService.callerOfBearer({ sub: 'user-1', roles: [] }),
    ).toEqual({ kind: 'guest' });
  });
});

describe('the default reach', () => {
  it('answers yes for everybody, until access lists replace it', async () => {
    expect(await new OpenAgentReach().reaches()).toBe(true);
  });
});

/**
 * CLEAN-236. A list scoped by reach answers "may they use the agent". Some
 * questions are about managing it, such as reading what other people said
 * to it, and the Ranch admin agent is one an Admin may reach without
 * managing.
 */
describe('ownerOnlyIds: the agents a caller reaches and still does not manage', () => {
  const ranch = agent({ id: 'agent-ranch', isAdmin: true });
  const agents = [agent(), ranch];

  it('is the Ranch admin agent, for an Admin, a User, a guest and another agent’s question', async () => {
    const { service } = make({ agents });

    for (const caller of [
      admin,
      user,
      guest,
      { kind: 'peer', chain: ['a'], connectionId: 'c' } as ICallerParty,
    ]) {
      expect(await service.ownerOnlyIds(caller)).toEqual(['agent-ranch']);
    }
  });

  it('is nothing for the Owner, and for that agent acting for itself', async () => {
    const { service, gateway } = make({ agents });

    expect(await service.ownerOnlyIds(owner)).toEqual([]);
    expect(await service.ownerOnlyIds(trusted)).toEqual([]);
    expect(gateway.findAdmin).not.toHaveBeenCalled();
  });

  it('is nothing on an installation with no Ranch admin agent', async () => {
    const { service } = make({ agents: [agent()] });

    expect(await service.ownerOnlyIds(admin)).toEqual([]);
  });
});
