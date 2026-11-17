import { ICreateSessionData, ISessionData } from './session.types';

export interface IPruneSessionsBefore {
  /** Delete rows whose absolute deadline is before this moment. */
  absoluteBefore: Date;
  /** Delete rows revoked before this moment. */
  revokedBefore: Date;
}

export abstract class ISessionGateway {
  abstract create(data: ICreateSessionData): Promise<ISessionData>;
  abstract findByHash(secretHash: string): Promise<ISessionData | null>;
  /** By id: what an acting token's `sid` claim names (CLEAN-232). */
  abstract findById(id: string): Promise<ISessionData | null>;
  /** Slide the inactivity deadline and stamp `lastSeenAt = now`. */
  abstract touch(id: string, expiresAt: Date): Promise<ISessionData>;
  /** Set `revokedAt = now` if not already revoked. */
  abstract revoke(id: string): Promise<void>;
  /** Housekeeping for one user; returns the number of rows removed. */
  abstract pruneForUser(
    userId: string,
    before: IPruneSessionsBefore,
  ): Promise<number>;
}
