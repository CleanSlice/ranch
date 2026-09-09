import type { IAuthGateway } from './auth.gateway';
import type { IAuthSession, IAuthUser } from './auth.types';

/**
 * Domain service for auth. Exposes me/login/register/refresh/logout; the store
 * layers in-memory token storage, the refresh timer and hydration on top. Named after the
 * slice — the generated `#api` `AuthService` is imported under an alias in the
 * data gateway to avoid the collision.
 */
export class AuthService {
  constructor(private gateway: IAuthGateway) {}

  me(): Promise<IAuthUser | null> {
    return this.gateway.me();
  }

  login(email: string, password: string): Promise<IAuthSession> {
    return this.gateway.login(email, password);
  }

  register(
    name: string,
    email: string,
    password: string,
  ): Promise<IAuthSession> {
    return this.gateway.register(name, email, password);
  }

  refresh(): Promise<IAuthSession> {
    return this.gateway.refresh();
  }

  logout(): Promise<void> {
    return this.gateway.logout();
  }
}
