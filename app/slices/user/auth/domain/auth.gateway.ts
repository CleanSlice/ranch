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
}
