// Domain types for platform users.

export enum UserRoleTypes {
  Owner = 'Owner',
  Admin = 'Admin',
  User = 'User',
}

export const ALL_USER_ROLES: UserRoleTypes[] = [
  UserRoleTypes.Owner,
  UserRoleTypes.Admin,
  UserRoleTypes.User,
];

// Roles an admin may assign. Owner exists once and is created at install
// time (POST /init) — the API rejects granting or revoking it.
export const ASSIGNABLE_USER_ROLES: UserRoleTypes[] = [
  UserRoleTypes.Admin,
  UserRoleTypes.User,
];

export enum UserStatusTypes {
  Active = 'active',
  Invited = 'invited',
  Disabled = 'disabled',
}

export interface IUserData {
  id: string;
  name: string;
  email: string;
  // Derived from `name` in UserMapper.toEntity — carried on the entity so
  // avatar UIs (userList, user detail) don't each reimplement the same
  // split/slice/uppercase logic.
  initials: string;
  role: UserRoleTypes;
  status: UserStatusTypes;
  createdAt: string;
}

export interface ICreateUserData {
  name: string;
  email: string;
  password: string;
  role: UserRoleTypes;
}

export interface IUpdateUserData {
  name?: string;
  email?: string;
  password?: string;
  status?: UserStatusTypes;
}
