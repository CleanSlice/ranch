import type { IAuthSession, IAuthUser } from './auth.types';

/**
 * Contract for admin auth. Implemented by `AuthGateway`. Only the network
 * round-trips live here — token storage, the refresh timer and the
 * bearer-header wiring stay in the store / api plugin.
 */
export abstract class IAuthGateway {
  abstract me(): Promise<IAuthUser | null>;
  abstract login(email: string, password: string): Promise<IAuthSession>;
  /** Trade the HttpOnly session cookie for a fresh access token. */
  abstract refresh(): Promise<IAuthSession>;
  /** Revoke the session behind the cookie and clear it. */
  abstract logout(): Promise<void>;
}
