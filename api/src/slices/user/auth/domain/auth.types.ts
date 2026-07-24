import { IUserData, UserRoleTypes } from '../../user/domain';

export interface IAuthTokenPayload {
  sub: string;
  email: string;
  // Always a singleton `[user.role]` for user tokens. Kept as an array for
  // wire compat with long-lived agent service tokens and embed tokens.
  roles: UserRoleTypes[];
}

export interface IAuthResult {
  accessToken: string;
  user: IUserData;
}
