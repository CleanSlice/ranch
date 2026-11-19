import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { UserTool } from './user.tool';
import type { IUserGateway } from './domain';
import { UserRoleTypes } from './domain';
import { asPerson, asTrustedAgent } from '#/mcp/testing';
import { audienceAllows } from '#/mcp/tooling';
import { toolAudienceOf } from '#/mcp/decorators';
import { openAccess } from '#/user/agentAccess/domain/__fixtures__/agentAccess';
import type { IAgentPinGateway } from '#/agent/pin/domain/agentPin.gateway';

/**
 * These tools put user accounts within a model's reach. Two properties are
 * worth more than any happy path: a password that went in through a tool
 * never comes back out of one (the sentinel below is the canary, also when
 * the gateway hands back rows with a hash on them), and the Owner account
 * survives whatever a prompt asks — the same rules `UserController` has.
 */
const SENTINEL = 'SENTINEL-PASS-99';

const request = (roles: UserRoleTypes[]): Request =>
  ({
    user: { sub: 'agent:agent-ops', email: '', roles },
  }) as unknown as Request;

const operator = () => asTrustedAgent(request([UserRoleTypes.Owner]));
const plainAgent = () => asTrustedAgent(request([UserRoleTypes.Agent]));

const at = new Date('2026-09-17T10:00:00.000Z');

const owner = {
  id: 'user-owner',
  name: 'Ranch Owner',
  email: 'owner@ranch.test',
  role: UserRoleTypes.Owner,
  status: 'active' as const,
  createdAt: at,
  updatedAt: at,
};

const jane = {
  id: 'user-jane',
  name: 'Jane Doe',
  email: 'jane@ranch.test',
  role: UserRoleTypes.User,
  status: 'invited' as const,
  createdAt: at,
  updatedAt: at,
};

interface Harness {
  tool: UserTool;
  users: {
    findAll: jest.Mock;
    findById: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  removeAccess: jest.SpyInstance;
  pins: { removeUser: jest.Mock };
}

function harness(): Harness {
  const users = {
    findAll: jest.fn().mockResolvedValue([owner, jane]),
    findById: jest.fn(
      async (id: string) => [owner, jane].find((u) => u.id === id) ?? null,
    ),
    create: jest.fn(async (data: { name: string; email: string }) => ({
      ...jane,
      id: 'user-new',
      name: data.name,
      email: data.email,
    })),
    update: jest.fn(async (id: string, patch: Record<string, unknown>) => ({
      ...([owner, jane].find((u) => u.id === id) ?? jane),
      ...patch,
    })),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const access = openAccess();
  const removeAccess = jest.spyOn(access, 'removeUser');
  const pins = {
    pin: jest.fn().mockResolvedValue(true),
    unpin: jest.fn().mockResolvedValue(true),
    pinnedIds: jest.fn().mockResolvedValue(new Set()),
    removeUser: jest.fn().mockResolvedValue(undefined),
  };
  const tool = new UserTool(
    users as unknown as IUserGateway,
    access,
    pins as unknown as IAgentPinGateway,
  );
  return { tool, users, removeAccess, pins };
}

const textOf = (result: { content: { text: string }[] }) =>
  result.content[0].text;

describe('UserTool — who may use it', () => {
  it('hides the tools from an agent that is not a Ranch operator', async () => {
    const { tool } = harness();
    await expect(tool.isListedForRequest(plainAgent())).resolves.toBe(false);
  });

  it('lists them for an operator agent', async () => {
    const { tool } = harness();
    await expect(tool.isListedForRequest(operator())).resolves.toBe(true);
  });

  it('refuses a call from a plain agent even by name', async () => {
    const { tool, users } = harness();
    await expect(tool.listUsers({}, null, plainAgent())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      tool.deleteUser({ userId: jane.id, confirm: true }, null, plainAgent()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(users.findAll).not.toHaveBeenCalled();
    expect(users.delete).not.toHaveBeenCalled();
  });

  it('refuses a caller with no roles at all', async () => {
    const { tool } = harness();
    await expect(
      tool.getUser({ userId: jane.id }, null, {} as Request),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

/**
 * CLEAN-232. The Ranch admin agent's token carries Owner, and it used to do
 * Owner things for whoever was chatting with it. What decides now is the
 * person the call is made for, checked against the same roles the console
 * routes state: `users` is @Roles(Admin), changing a role and removing an
 * account are @Roles(Owner).
 */
describe('UserTool — the Ranch admin agent answering a person', () => {
  /** The agent's own token: Owner, whoever it is talking to. */
  const ranch = () => request([UserRoleTypes.Owner]);
  const answering = (role: UserRoleTypes) => () => asPerson(ranch(), role);

  it('does nothing for a User, though its token carries Owner', async () => {
    const { tool, users } = harness();
    const user = answering(UserRoleTypes.User);

    await expect(tool.isListedForRequest(user())).resolves.toBe(false);
    const calls = [
      () => tool.listUsers({}, null, user()),
      () => tool.getUser({ userId: owner.id }, null, user()),
      () =>
        tool.createUser(
          {
            name: 'Mallory',
            email: 'mallory@ranch.test',
            password: SENTINEL,
            role: UserRoleTypes.Admin,
          },
          null,
          user(),
        ),
      () =>
        tool.updateUser({ userId: owner.id, password: SENTINEL }, null, user()),
      () =>
        tool.setUserRole(
          { userId: jane.id, role: UserRoleTypes.Admin, confirm: true },
          null,
          user(),
        ),
      () => tool.deleteUser({ userId: jane.id, confirm: true }, null, user()),
    ];
    for (const call of calls) {
      await expect(call()).rejects.toThrow(
        new ForbiddenException(
          'This tool requires the Ranch operator role. Ask the operator to do it ' +
            'in the console, or through the Ranch admin agent.',
        ),
      );
    }
    for (const fn of Object.values(users)) expect(fn).not.toHaveBeenCalled();
  });

  it('lets an Admin do what the Admin routes allow, and not the Owner’s two', async () => {
    const { tool, users } = harness();
    const admin = answering(UserRoleTypes.Admin);

    await expect(tool.isListedForRequest(admin())).resolves.toBe(true);
    await expect(tool.listUsers({}, null, admin())).resolves.toBeDefined();
    await expect(
      tool.updateUser({ userId: jane.id, name: 'Jane D.' }, null, admin()),
    ).resolves.toBeDefined();
    expect(users.update).toHaveBeenCalledTimes(1);

    await expect(
      tool.setUserRole(
        { userId: jane.id, role: UserRoleTypes.Admin, confirm: true },
        null,
        admin(),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      tool.deleteUser({ userId: jane.id, confirm: true }, null, admin()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(users.update).toHaveBeenCalledTimes(1);
    expect(users.delete).not.toHaveBeenCalled();

    for (const method of ['setUserRole', 'deleteUser'] as const) {
      const audience = toolAudienceOf(UserTool, tool[method]);
      expect(audience).toBe('owner');
      expect(audienceAllows(audience, admin())).toBe(false);
    }
    expect(toolAudienceOf(UserTool, tool['listUsers'])).toBe('admin');
  });

  it('lets the Owner change a role and remove an account', async () => {
    const { tool, users } = harness();
    const theOwner = answering(UserRoleTypes.Owner);

    await tool.setUserRole(
      { userId: jane.id, role: UserRoleTypes.Admin, confirm: true },
      null,
      theOwner(),
    );
    await tool.deleteUser({ userId: jane.id, confirm: true }, null, theOwner());

    expect(users.update).toHaveBeenCalledWith(jane.id, {
      role: UserRoleTypes.Admin,
    });
    expect(users.delete).toHaveBeenCalledWith(jane.id);
  });

  it('is a guest when the call names nobody: told to sign in, not to find an operator', async () => {
    const { tool, users } = harness();

    await expect(tool.isListedForRequest(ranch())).resolves.toBe(false);
    await expect(tool.listUsers({}, null, ranch())).rejects.toThrow(
      new ForbiddenException('This needs a signed-in administrator.'),
    );
    await expect(
      tool.deleteUser({ userId: jane.id, confirm: true }, null, ranch()),
    ).rejects.toThrow(
      new ForbiddenException('This needs a signed-in administrator.'),
    );
    expect(users.findAll).not.toHaveBeenCalled();
    expect(users.delete).not.toHaveBeenCalled();
  });
});

describe('UserTool — reading', () => {
  it('lists every user with role and status', async () => {
    const { tool, users } = harness();
    const text = textOf(await tool.listUsers({}, null, operator()));
    expect(users.findAll).toHaveBeenCalledTimes(1);
    expect(text).toContain('jane@ranch.test');
    expect(text).toContain('owner@ranch.test');
    expect(text).toContain('"role": "User"');
    expect(text).toContain('"status": "invited"');
  });

  it('never lists a password hash, even when the gateway hands one back', async () => {
    const { tool, users } = harness();
    users.findAll.mockResolvedValue([
      { ...jane, password: SENTINEL },
      { ...owner, passwordHash: SENTINEL },
    ]);
    const text = textOf(await tool.listUsers({}, null, operator()));
    expect(text).toContain('jane@ranch.test');
    expect(text).not.toContain(SENTINEL);
    expect(text).not.toContain('password');
  });

  it('shows one user by id', async () => {
    const { tool, users } = harness();
    const text = textOf(
      await tool.getUser({ userId: jane.id }, null, operator()),
    );
    expect(users.findById).toHaveBeenCalledWith(jane.id);
    expect(text).toContain('Jane Doe');
    expect(text).toContain('"id": "user-jane"');
  });

  it('names list_users when the user does not exist', async () => {
    const { tool } = harness();
    const text = textOf(
      await tool.getUser({ userId: 'user-nope' }, null, operator()),
    );
    expect(text).toContain('not found');
    expect(text).toContain('list_users');
  });
});

describe('UserTool — creating', () => {
  it('creates a user through the gateway and hands back the row without the password', async () => {
    const { tool, users } = harness();
    const text = textOf(
      await tool.createUser(
        {
          name: 'New Person',
          email: 'new@ranch.test',
          password: SENTINEL,
          role: UserRoleTypes.Admin,
        },
        null,
        operator(),
      ),
    );
    expect(users.create).toHaveBeenCalledWith({
      name: 'New Person',
      email: 'new@ranch.test',
      password: SENTINEL,
      role: UserRoleTypes.Admin,
    });
    expect(text).toContain('"id": "user-new"');
    expect(text).toContain('new@ranch.test');
    expect(text).not.toContain(SENTINEL);
  });

  it('strips a password the gateway echoes back on the created row', async () => {
    const { tool, users } = harness();
    users.create.mockResolvedValue({ ...jane, password: SENTINEL });
    const text = textOf(
      await tool.createUser(
        { name: 'Jane Doe', email: 'jane@ranch.test', password: SENTINEL },
        null,
        operator(),
      ),
    );
    expect(text).not.toContain(SENTINEL);
  });
});

describe('UserTool — updating', () => {
  it('passes only the given fields to the gateway', async () => {
    const { tool, users } = harness();
    const text = textOf(
      await tool.updateUser(
        { userId: jane.id, name: 'Jane Smith', status: 'active' },
        null,
        operator(),
      ),
    );
    expect(users.update).toHaveBeenCalledWith(jane.id, {
      name: 'Jane Smith',
      status: 'active',
    });
    expect(text).toContain('Jane Smith');
    expect(text).toContain('"status": "active"');
  });

  it('accepts a new password and never repeats it', async () => {
    const { tool, users } = harness();
    const text = textOf(
      await tool.updateUser(
        { userId: jane.id, password: SENTINEL },
        null,
        operator(),
      ),
    );
    expect(users.update).toHaveBeenCalledWith(jane.id, { password: SENTINEL });
    expect(text).not.toContain(SENTINEL);
  });

  it('refuses to change the Owner account status, as the controller does', async () => {
    const { tool, users } = harness();
    const result = await tool.updateUser(
      { userId: owner.id, status: 'disabled' },
      null,
      operator(),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Owner account status cannot be changed');
    expect(users.update).not.toHaveBeenCalled();
  });

  it('still lets the Owner rename themselves', async () => {
    const { tool, users } = harness();
    await tool.updateUser(
      { userId: owner.id, name: 'The Boss' },
      null,
      operator(),
    );
    expect(users.update).toHaveBeenCalledWith(owner.id, { name: 'The Boss' });
  });

  it('asks for at least one field', async () => {
    const { tool, users } = harness();
    const result = await tool.updateUser({ userId: jane.id }, null, operator());
    expect(result.isError).toBe(true);
    expect(users.update).not.toHaveBeenCalled();
  });

  it('names list_users when the user does not exist', async () => {
    const { tool, users } = harness();
    const text = textOf(
      await tool.updateUser(
        { userId: 'user-nope', name: 'X Y' },
        null,
        operator(),
      ),
    );
    expect(text).toContain('not found');
    expect(users.update).not.toHaveBeenCalled();
  });
});

describe('UserTool — setting a role', () => {
  it('changes the role once confirmed', async () => {
    const { tool, users } = harness();
    const text = textOf(
      await tool.setUserRole(
        { userId: jane.id, role: UserRoleTypes.Admin, confirm: true },
        null,
        operator(),
      ),
    );
    expect(users.update).toHaveBeenCalledWith(jane.id, {
      role: UserRoleTypes.Admin,
    });
    expect(text).toContain('"role": "Admin"');
  });

  it('refuses without the confirmation argument and names the user by email', async () => {
    const { tool, users } = harness();
    const result = await tool.setUserRole(
      { userId: jane.id, role: UserRoleTypes.Admin },
      null,
      operator(),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('confirm: true');
    expect(textOf(result)).toContain('«jane@ranch.test»');
    expect(users.update).not.toHaveBeenCalled();
  });

  it('reports not-found before asking for a confirmation', async () => {
    const { tool, users } = harness();
    const text = textOf(
      await tool.setUserRole(
        { userId: 'user-nope', role: UserRoleTypes.Admin },
        null,
        operator(),
      ),
    );
    expect(text).toContain('not found');
    expect(users.update).not.toHaveBeenCalled();
  });

  it('never re-roles the Owner, as the controller does', async () => {
    const { tool, users } = harness();
    const result = await tool.setUserRole(
      { userId: owner.id, role: UserRoleTypes.User, confirm: true },
      null,
      operator(),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Owner role cannot be changed');
    expect(users.update).not.toHaveBeenCalled();
  });

  it('never assigns Owner, as the DTO whitelist does', async () => {
    const { tool, users } = harness();
    const result = await tool.setUserRole(
      { userId: jane.id, role: UserRoleTypes.Owner, confirm: true },
      null,
      operator(),
    );
    expect(result.isError).toBe(true);
    expect(users.update).not.toHaveBeenCalled();
  });

  it('is a no-op when the user already has that role', async () => {
    const { tool, users } = harness();
    const text = textOf(
      await tool.setUserRole(
        { userId: jane.id, role: UserRoleTypes.User },
        null,
        operator(),
      ),
    );
    expect(text).toContain('already has the role');
    expect(users.update).not.toHaveBeenCalled();
  });
});

describe('UserTool — removing', () => {
  it('removes the user once confirmed', async () => {
    const { tool, users } = harness();
    const text = textOf(
      await tool.deleteUser(
        { userId: jane.id, confirm: true },
        null,
        operator(),
      ),
    );
    expect(users.delete).toHaveBeenCalledWith(jane.id);
    expect(text).toContain('jane@ranch.test');
  });

  it('takes the account’s agent access lists and pins with it, as the route does', async () => {
    const { tool, removeAccess, pins } = harness();
    await tool.deleteUser({ userId: jane.id, confirm: true }, null, operator());
    expect(removeAccess).toHaveBeenCalledWith(jane.id);
    expect(pins.removeUser).toHaveBeenCalledWith(jane.id);

    // Nothing is removed for a call that was not confirmed.
    const unconfirmed = harness();
    await unconfirmed.tool.deleteUser({ userId: jane.id }, null, operator());
    expect(unconfirmed.removeAccess).not.toHaveBeenCalled();
    expect(unconfirmed.pins.removeUser).not.toHaveBeenCalled();
  });

  it('refuses without the confirmation argument and names the user by email', async () => {
    const { tool, users } = harness();
    const result = await tool.deleteUser({ userId: jane.id }, null, operator());
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('confirm: true');
    expect(textOf(result)).toContain('«jane@ranch.test»');
    expect(users.delete).not.toHaveBeenCalled();
  });

  it('reports not-found before asking for a confirmation', async () => {
    const { tool, users } = harness();
    const text = textOf(
      await tool.deleteUser({ userId: 'user-nope' }, null, operator()),
    );
    expect(text).toContain('not found');
    expect(text).toContain('list_users');
    expect(users.delete).not.toHaveBeenCalled();
  });

  it('never removes the Owner, as the controller does', async () => {
    const { tool, users } = harness();
    const result = await tool.deleteUser(
      { userId: owner.id, confirm: true },
      null,
      operator(),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Owner account cannot be removed');
    expect(users.delete).not.toHaveBeenCalled();
  });
});

/**
 * Who may change which account (CLEAN-232), the same rule as
 * `PUT /users/:id`: the Owner anyone; an Admin the Users and their own name,
 * email and password; never the Owner's account or another Admin's. A new
 * password on either of those would be that person's role.
 */
describe('UserTool — who may change which account', () => {
  const bob = {
    ...jane,
    id: 'user-bob',
    name: 'Bob Admin',
    email: 'bob@ranch.test',
    role: UserRoleTypes.Admin,
    status: 'active' as const,
  };
  const ada = {
    ...bob,
    id: 'user-ada',
    name: 'Ada Admin',
    email: 'ada@t.test',
  };

  /** The Ranch admin agent answering `ada`, an Admin. */
  const asAda = () =>
    asPerson(request([UserRoleTypes.Owner]), UserRoleTypes.Admin, ada.id);
  const asTheOwner = () =>
    asPerson(request([UserRoleTypes.Owner]), UserRoleTypes.Owner, owner.id);

  function people() {
    const h = harness();
    const rows = [owner, jane, bob, ada];
    h.users.findById.mockImplementation(
      async (id: string) => rows.find((u) => u.id === id) ?? null,
    );
    return h;
  }

  it('an Admin changes a User', async () => {
    const { tool, users } = people();
    const result = await tool.updateUser(
      { userId: jane.id, name: 'Jane D.', status: 'disabled' },
      null,
      asAda(),
    );
    expect(result.isError).toBeUndefined();
    expect(users.update).toHaveBeenCalledWith(jane.id, {
      name: 'Jane D.',
      status: 'disabled',
    });
  });

  it('an Admin does not change the Owner: not the password, not the email, not the name', async () => {
    const { tool, users } = people();
    for (const patch of [
      { password: SENTINEL },
      { email: 'taken@over.test' },
      { name: 'Somebody Else' },
    ]) {
      const result = await tool.updateUser(
        { userId: owner.id, ...patch },
        null,
        asAda(),
      );
      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe(
        'Only the Owner can change the Owner account. Ask the Owner to do it ' +
          'from their own session.',
      );
      expect(textOf(result)).not.toContain(SENTINEL);
    }
    expect(users.update).not.toHaveBeenCalled();
  });

  it('an Admin does not change another Admin', async () => {
    const { tool, users } = people();
    const result = await tool.updateUser(
      { userId: bob.id, password: SENTINEL },
      null,
      asAda(),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      "An Admin cannot change another Admin's account. Ask the Owner to do it.",
    );
    expect(users.update).not.toHaveBeenCalled();
  });

  it('an Admin changes their own name, email and password', async () => {
    const { tool, users } = people();
    const result = await tool.updateUser(
      {
        userId: ada.id,
        name: 'Ada L.',
        email: 'ada@new.test',
        password: SENTINEL,
      },
      null,
      asAda(),
    );
    expect(result.isError).toBeUndefined();
    expect(users.update).toHaveBeenCalledWith(ada.id, {
      name: 'Ada L.',
      email: 'ada@new.test',
      password: SENTINEL,
    });
    expect(textOf(result)).not.toContain(SENTINEL);
  });

  it('but not their own status', async () => {
    const { tool, users } = people();
    const result = await tool.updateUser(
      { userId: ada.id, status: 'disabled' },
      null,
      asAda(),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(
      'You cannot change the status of your own account.',
    );
    expect(users.update).not.toHaveBeenCalled();
  });

  it('the Owner changes anyone, another Admin included', async () => {
    const { tool, users } = people();
    await tool.updateUser(
      { userId: bob.id, password: SENTINEL },
      null,
      asTheOwner(),
    );
    await tool.updateUser(
      { userId: jane.id, name: 'J' + 'ane' },
      null,
      asTheOwner(),
    );
    await tool.updateUser(
      { userId: owner.id, name: 'The Boss' },
      null,
      asTheOwner(),
    );
    expect(users.update).toHaveBeenCalledTimes(3);
  });

  it('the Ranch admin agent acting for itself is trusted, as before', async () => {
    const { tool, users } = people();
    await tool.updateUser({ userId: bob.id, name: 'Robert' }, null, operator());
    expect(users.update).toHaveBeenCalledWith(bob.id, { name: 'Robert' });
  });

  it('an Admin may still create an Admin, as POST /users allows', async () => {
    const { tool, users } = people();
    const result = await tool.createUser(
      {
        name: 'New Admin',
        email: 'new@ranch.test',
        password: SENTINEL,
        role: UserRoleTypes.Admin,
      },
      null,
      asAda(),
    );
    expect(result.isError).toBeUndefined();
    expect(users.create).toHaveBeenCalledWith(
      expect.objectContaining({ role: UserRoleTypes.Admin }),
    );
  });
});
