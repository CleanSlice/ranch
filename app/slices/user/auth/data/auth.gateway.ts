// The generated SDK class is also named `AuthService`; alias it to `AuthApi`
// so it doesn't collide with the domain service of the same name.
import { AuthService as AuthApi } from '#api';
import { BaseGateway } from '#common/data/BaseGateway';
import { unwrapEnvelope } from '#common/data/unwrapEnvelope';
import { IAuthGateway } from '../domain/auth.gateway';
import type { IAuthSession, IAuthUser } from '../domain/auth.types';
import { AuthErrorMapper } from './authError.mapper';
import { AuthMapper } from './auth.mapper';

export class AuthGateway extends BaseGateway implements IAuthGateway {
  private mapper = new AuthMapper();

  constructor() {
    // Route raw axios failures through the auth error mapper so callers get a
    // typed domain error with a user-facing message instead of a silent
    // empty session.
    super(new AuthErrorMapper());
  }

  // `throwOnError: true` — the axios client returns the error object instead of
  // throwing by default; opt in so `execute()`'s catch fires and maps it.
  me(): Promise<IAuthUser | null> {
    return this.execute(async () => {
      const res = await AuthApi.authControllerMe({ throwOnError: true });
      return this.mapper.toUser(unwrapEnvelope(res.data));
    });
  }

  login(email: string, password: string): Promise<IAuthSession> {
    return this.execute(async () => {
      const res = await AuthApi.authControllerLogin({
        body: { email, password },
        throwOnError: true,
      });
      return this.mapper.toSession(unwrapEnvelope(res.data));
    });
  }

  register(
    name: string,
    email: string,
    password: string,
  ): Promise<IAuthSession> {
    return this.execute(async () => {
      const res = await AuthApi.authControllerRegister({
        body: { name, email, password },
        throwOnError: true,
      });
      return this.mapper.toSession(unwrapEnvelope(res.data));
    });
  }
}
