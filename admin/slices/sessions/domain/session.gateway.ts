import type { ISessionData } from './session.types';

/**
 * Contract for integration sessions. Implemented by `SessionGateway`, which
 * talks to ranch-api over the low-level SDK client (these endpoints aren't in
 * the generated SDK).
 */
export abstract class ISessionGateway {
  abstract list(): Promise<ISessionData[]>;
  abstract disconnect(id: string): Promise<void>;
}
