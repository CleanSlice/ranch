// What a role may do in this console, for the profile's "What you can do"
// list (CLEAN-217). Pure on purpose: no Vue, no Nuxt aliases, so `bun test`
// runs it. The role arrives as the string the server sent.

export type CapabilityKey = 'create' | 'control' | 'slots' | 'share' | 'users';

/** `elsewhere`: allowed, but done in the admin console, not here. */
export type CapabilityState = 'yes' | 'elsewhere' | 'locked';

export interface ICapability {
  key: CapabilityKey;
  state: CapabilityState;
  /** Which roles the item is open to: an i18n key under `profile.cap_roles`. */
  rolesKey: 'operators' | 'all' | 'owner_admin_console';
  /** Why it is locked: an i18n key under `profile.cap_lock`, null when not. */
  lockKey: 'needs_admin' | 'owner_only' | null;
}

/**
 * The five items, always in this order, never hidden: a locked item tells a
 * person what they are missing, a hidden one tells them nothing.
 *
 * Each row follows a rule the code or the server already enforces:
 *  - create / control / slots: `hasRole(Owner, Admin)` in the agents pages;
 *  - share: no role gate, whoever can open an agent may share it;
 *  - users: `@Roles(Owner)` on `PUT /users/:id/role` and `DELETE /users/:id`,
 *    and the screens for it live in the admin console.
 *
 * A role this console does not know (an agent's own token, a role added
 * later) gets every item locked: saying "you can share" to something we
 * cannot place would be a guess.
 */
export function capabilitiesFor(role: string | null | undefined): ICapability[] {
  const r = (role ?? '').toLowerCase();
  const owner = r === 'owner';
  const operator = owner || r === 'admin';
  const known = operator || r === 'user';

  const operatorRow = (key: CapabilityKey): ICapability => ({
    key,
    state: operator ? 'yes' : 'locked',
    rolesKey: 'operators',
    lockKey: operator ? null : 'needs_admin',
  });

  return [
    operatorRow('create'),
    operatorRow('control'),
    operatorRow('slots'),
    {
      key: 'share',
      state: known ? 'yes' : 'locked',
      rolesKey: 'all',
      lockKey: known ? null : 'needs_admin',
    },
    {
      key: 'users',
      state: owner ? 'elsewhere' : 'locked',
      rolesKey: 'owner_admin_console',
      lockKey: owner ? null : 'owner_only',
    },
  ];
}
