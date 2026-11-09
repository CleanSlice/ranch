import { describe, expect, test } from 'bun:test';
import { capabilitiesFor } from './capabilities';

const states = (role: string | null) =>
  capabilitiesFor(role).map((c) => `${c.key}:${c.state}`);
const locks = (role: string | null) =>
  capabilitiesFor(role).map((c) => c.lockKey);

describe('capabilitiesFor', () => {
  test('always the same five items in the same order', () => {
    expect(capabilitiesFor('Owner').map((c) => c.key)).toEqual([
      'create',
      'control',
      'slots',
      'share',
      'users',
    ]);
    expect(capabilitiesFor('User').length).toBe(5);
    expect(capabilitiesFor(null).length).toBe(5);
  });

  test('an owner may do everything, user management in the admin console', () => {
    expect(states('Owner')).toEqual([
      'create:yes',
      'control:yes',
      'slots:yes',
      'share:yes',
      'users:elsewhere',
    ]);
    expect(locks('Owner')).toEqual([null, null, null, null, null]);
  });

  test('an admin runs agents but does not manage users', () => {
    expect(states('Admin')).toEqual([
      'create:yes',
      'control:yes',
      'slots:yes',
      'share:yes',
      'users:locked',
    ]);
    expect(locks('Admin')).toEqual([null, null, null, null, 'owner_only']);
  });

  test('a user shares and chats; the rest is locked with the role that unlocks it', () => {
    expect(states('User')).toEqual([
      'create:locked',
      'control:locked',
      'slots:locked',
      'share:yes',
      'users:locked',
    ]);
    expect(locks('User')).toEqual([
      'needs_admin',
      'needs_admin',
      'needs_admin',
      null,
      'owner_only',
    ]);
  });

  test('the role is matched whatever its letter case', () => {
    expect(states('owner')).toEqual(states('Owner'));
    expect(states('ADMIN')).toEqual(states('Admin'));
  });

  test('a role the console does not know gets everything locked', () => {
    for (const role of ['Agent', 'superuser', '', null]) {
      expect(capabilitiesFor(role).every((c) => c.state === 'locked')).toBe(true);
    }
  });

  test('each item names the roles it is open to', () => {
    expect(capabilitiesFor('User').map((c) => c.rolesKey)).toEqual([
      'operators',
      'operators',
      'operators',
      'all',
      'owner_admin_console',
    ]);
  });
});
