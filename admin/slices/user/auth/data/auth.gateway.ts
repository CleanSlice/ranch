// The generated SDK class is also named `AuthService`; alias it to `AuthApi`
// so it doesn't collide with the domain service of the same name.
import { AuthService as AuthApi } from '#api/data';
import { BaseGateway } from '#common/data/BaseGateway';
import { unwrapEnvelope } from '#common/data/unwrapEnvelope';
import { IAuthGateway } from '../domain/auth.gateway';
import type { IAuthSession, IAuthUser } from '../domain/auth.types';
import { AuthMapper } from './auth.mapper';

export class AuthGateway extends BaseGateway implements IAuthGateway {
  private mapper = new AuthMapper();

  me(): Promise<IAuthUser | null> {
    return this.execute(async () => {
      const res = await AuthApi.authControllerMe();
      return this.mapper.toUser(unwrapEnvelope(res.data));
    });
  }

  login(email: string, password: string): Promise<IAuthSession> {
    return this.execute(async () => {
      const res = await AuthApi.authControllerLogin({
        body: { email, password },
      });
      return this.mapper.toSession(unwrapEnvelope(res.data));
    });
  }
}
