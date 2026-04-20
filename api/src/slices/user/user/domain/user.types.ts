export type UserRoleTypes = 'owner' | 'admin' | 'member';

export type UserStatusTypes = 'active' | 'invited' | 'disabled';

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
