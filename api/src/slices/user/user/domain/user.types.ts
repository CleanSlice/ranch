export enum UserRoleTypes {
  Owner = 'Owner',
  Admin = 'Admin',
  User = 'User',
  // Issued only via JWT to agent runtimes (sub=`agent:<id>`). Never assigned
  // to a real user. Scopes the token to "this specific agent's own data".
  Agent = 'Agent',
}

export type UserStatusTypes = 'active' | 'invited' | 'disabled';

export const ALL_USER_ROLES: UserRoleTypes[] = [
  UserRoleTypes.Owner,
  UserRoleTypes.Admin,
  UserRoleTypes.User,
  UserRoleTypes.Agent,
];

/**
 * Roles an admin may assign to a user. Owner exists only once and is created
 * exclusively via POST /init; Agent lives only inside JWTs.
 */
export const ASSIGNABLE_USER_ROLES = [
  UserRoleTypes.Admin,
  UserRoleTypes.User,
] as const;

export const ROLE_LEVELS: Record<UserRoleTypes, number> = {
  [UserRoleTypes.Owner]: 3,
  [UserRoleTypes.Admin]: 2,
  [UserRoleTypes.User]: 1,
  // Outside the hierarchy — matched exactly, never by level.
  [UserRoleTypes.Agent]: 0,
};

/**
 * Hierarchical role check: Owner > Admin > User, a higher role implies the
 * lower ones. Agent is exact-match only, in both directions.
 */
export function hasAtLeastRole(
  actual: UserRoleTypes,
  required: UserRoleTypes,
): boolean {
  if (required === UserRoleTypes.Agent) return actual === UserRoleTypes.Agent;
  if (actual === UserRoleTypes.Agent) return false;
  return ROLE_LEVELS[actual] >= ROLE_LEVELS[required];
}

export interface IUserData {
  id: string;
  name: string;
  email: string;
  role: UserRoleTypes;
  status: UserStatusTypes;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICreateUserData {
  name: string;
  email: string;
  password: string;
  role?: UserRoleTypes;
}

export interface IUpdateUserData {
  name?: string;
  email?: string;
  password?: string;
  role?: UserRoleTypes;
  status?: UserStatusTypes;
}
