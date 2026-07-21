import type { IAuthSession, IAuthUser } from './auth.types';

/**
 * Contract for admin auth. Implemented by `AuthGateway`. Only the network
 * round-trips live here — token persistence and the bearer-header wiring stay
 * in the store.
 */
export abstract class IAuthGateway {
  abstract me(): Promise<IAuthUser | null>;
  abstract login(email: string, password: string): Promise<IAuthSession>;
}
