// Domain types for the auth slice. The data layer maps the (loosely-typed
// `unknown`) auth responses onto these; the store owns token/session state.

export enum UserRoleTypes {
  Owner = 'Owner',
  Admin = 'Admin',
  User = 'User',
}

export interface IAuthUser {
  id: string;
  name: string;
  email: string;
  roles: UserRoleTypes[];
  status: string;
}

/** A successful login/register result: bearer token + the authenticated user. */
export interface IAuthSession {
  accessToken: string;
  user: IAuthUser;
}
