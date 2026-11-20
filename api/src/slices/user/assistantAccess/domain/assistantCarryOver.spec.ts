import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { UserRoleTypes } from '#/user/user/domain/user.types';
import { carryOver } from './assistantCarryOver';

const ROLES: Record<string, UserRoleTypes> = {
  admin: UserRoleTypes.Admin,
  user: UserRoleTypes.User,
  owner: UserRoleTypes.Owner,
};
const roleOf = (id: string) => ROLES[id] ?? null;

describe('carrying the assistant out of the agent lists (FR-030)', () => {
  it('Denied stays off, at the level the role would get', () => {
    const { exceptions, entries } = carryOver(
      [
        { userId: 'admin', agentId: 'R', list: 'denied' },
        { userId: 'user', agentId: 'R', list: 'denied' },
        { userId: 'user', agentId: 'A', list: 'denied' },
      ],
      'R',
      roleOf,
    );
    expect(exceptions).toEqual([
      { userId: 'admin', enabled: false, level: 'full' },
      { userId: 'user', enabled: false, level: 'basic' },
    ]);
    expect(entries).toEqual([{ userId: 'user', agentId: 'A', list: 'denied' }]);
  });

  it('Allowed is on by default: nothing is written, the other agents stay', () => {
    const { exceptions, entries } = carryOver(
      [
        { userId: 'admin', agentId: 'R', list: 'allowed' },
        { userId: 'admin', agentId: 'A', list: 'allowed' },
      ],
      'R',
      roleOf,
    );
    expect(exceptions).toEqual([]);
    expect(entries).toEqual([
      { userId: 'admin', agentId: 'A', list: 'allowed' },
    ]);
  });

  it('an Allowed list that never named it writes nothing either', () => {
    const before = [{ userId: 'user', agentId: 'A', list: 'allowed' as const }];
    expect(carryOver(before, 'R', roleOf)).toEqual({
      exceptions: [],
      entries: before,
    });
  });

  it('writes nothing for the Owner or for an account that is gone', () => {
    const { exceptions, entries } = carryOver(
      [
        { userId: 'owner', agentId: 'R', list: 'denied' },
        { userId: 'ghost', agentId: 'R', list: 'denied' },
      ],
      'R',
      roleOf,
    );
    expect(exceptions).toEqual([]);
    expect(entries).toEqual([]);
  });

  it('without an assistant nothing moves', () => {
    const before = [{ userId: 'user', agentId: 'A', list: 'denied' as const }];
    expect(carryOver(before, null, roleOf)).toEqual({
      exceptions: [],
      entries: before,
    });
  });

  // The migration is this rule in SQL. If one is edited, the other is read.
  it('the migration says the same in SQL', () => {
    const sql = readFileSync(
      join(
        __dirname,
        '../../../../../prisma/migrations/20261120200000_assistant_access/migration.sql',
      ),
      'utf8',
    );
    expect(sql).toMatch(/e\."list" = 'denied'/);
    expect(sql).toMatch(/a\."isAdmin" = true/);
    expect(sql).toMatch(/u\."role" IN \('Admin', 'User'\)/);
    expect(sql).toMatch(/WHEN u\."role" = 'Admin' THEN 'full' ELSE 'basic'/);
    expect(sql).toMatch(/DELETE FROM "UserAgentAccessEntry"/);
    expect(sql).not.toMatch(/UPDATE "UserAgentAccess"/);
  });
});
