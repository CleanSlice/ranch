import { IUserData } from '../../user/domain';

export interface IAuthTokenPayload {
  sub: string;
  email: string;
  role: string;
  roles: string[];
}

export interface IAuthResult {
  accessToken: string;
  user: IUserData;
}
