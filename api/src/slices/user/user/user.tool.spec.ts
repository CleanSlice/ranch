import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { UserTool } from './user.tool';
import type { IUserGateway } from './domain';
import { UserRoleTypes } from './domain';

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

const operator = () => request([UserRoleTypes.Owner]);
const plainAgent = () => request([UserRoleTypes.Agent]);

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
  const tool = new UserTool(users as unknown as IUserGateway);
  return { tool, users };
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
