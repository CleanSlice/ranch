import type { IAuthGateway } from './auth.gateway';
import type { IAuthSession, IAuthUser } from './auth.types';

/**
 * Domain service for admin auth. The store layers token storage (cookie), the
 * bearer-header side effect, and hydration on top. Named after the slice — the
 * generated `#api` `AuthService` is imported under an alias in the data gateway.
 */
export class AuthService {
  constructor(private gateway: IAuthGateway) {}

  me(): Promise<IAuthUser | null> {
    return this.gateway.me();
  }

  login(email: string, password: string): Promise<IAuthSession> {
    return this.gateway.login(email, password);
  }
}
