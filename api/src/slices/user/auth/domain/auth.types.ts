import { IUserData, UserRoleTypes } from '../../user/domain';
import type { IRlmJobScope } from '#/rlm/domain/rlm-scope.types';

export interface IAuthTokenPayload {
  sub: string;
  email: string;
  roles: UserRoleTypes[];
  // Present only on tokens minted by issueRlmJobToken (sub starts with
  // 'rlm-job:'). RlmJobGuard re-validates every internal-context request
  // against this claim instead of a server-side job registry.
  rlmScope?: IRlmJobScope;
}

export interface IAuthResult {
  accessToken: string;
  user: IUserData;
}
