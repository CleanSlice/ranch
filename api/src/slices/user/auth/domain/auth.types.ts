import { IUserData, UserRoleTypes } from '../../user/domain';

export interface IAuthTokenPayload {
  sub: string;
  email: string;
  roles: UserRoleTypes[];
}

export interface IAuthResult {
  accessToken: string;
  user: IUserData;
}
