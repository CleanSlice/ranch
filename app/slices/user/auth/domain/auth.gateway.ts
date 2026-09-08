import type { IAuthSession, IAuthUser } from './auth.types';

/**
 * Contract for the auth API. Implemented by `AuthGateway` in the data layer.
 * Only the pure network round-trips live here — token persistence and the
 * bearer-header wiring stay in the store.
 */
export abstract class IAuthGateway {
  abstract me(): Promise<IAuthUser | null>;
  abstract login(email: string, password: string): Promise<IAuthSession>;
  abstract register(
    name: string,
    email: string,
    password: string,
  ): Promise<IAuthSession>;
  /** Renew the access token from the httpOnly session cookie alone. */
  abstract refresh(): Promise<IAuthSession>;
  /** Revoke the session behind the cookie and clear it. Never a 401. */
  abstract logout(): Promise<void>;
}
