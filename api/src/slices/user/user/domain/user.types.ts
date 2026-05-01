export enum UserRoleTypes {
  Owner = 'Owner',
  Admin = 'Admin',
  User = 'User',
}

export type UserStatusTypes = 'active' | 'invited' | 'disabled';

export const ALL_USER_ROLES: UserRoleTypes[] = [
  UserRoleTypes.Owner,
  UserRoleTypes.Admin,
  UserRoleTypes.User,
];

export interface IUserData {
  id: string;
  name: string;
  email: string;
  roles: UserRoleTypes[];
  status: UserStatusTypes;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICreateUserData {
  name: string;
  email: string;
  password: string;
  roles?: UserRoleTypes[];
}

export interface IUpdateUserData {
  name?: string;
  email?: string;
  password?: string;
  roles?: UserRoleTypes[];
  status?: UserStatusTypes;
}
