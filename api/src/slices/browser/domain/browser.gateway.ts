import type {
  IBrowserSessionConnection,
  IBrowserSessionData,
  IFindBrowserSessionsFilter,
  BrowserSessionStatusTypes,
} from './browser.types';

/**
 * Browser gateway — manages browser-pool sessions and their lifecycle.
 *
 * Each session is uniquely keyed by (userId, accountKey). The persistent
 * profile (cookies, logged-in state) lives on the pool PVC at
 * /profiles/<userId>/<accountKey> — the gateway is the only thing that
 * builds that path, so userId always comes from the authenticated request,
 * never from caller input.
 */
export abstract class IBrowserGateway {
  /**
   * Open (or reuse) a session for the given accountKey on behalf of userId.
   * Returns a fresh CDP URL and (optionally) a VNC URL the user can open
   * in a browser to finish login flows manually.
   */
  abstract openSession(
    userId: string,
    accountKey: string,
  ): Promise<IBrowserSessionConnection>;

  /** Close the session and free the underlying browser. Profile data stays. */
  abstract closeSession(userId: string, sessionId: string): Promise<void>;

  /**
   * Hard-kill the underlying browser process, then create a new one with
   * the same profile. Used when a session is stuck on a 120s tool timeout.
   */
  abstract resetSession(
    userId: string,
    sessionId: string,
  ): Promise<IBrowserSessionConnection>;

  /**
   * Wipe the profile directory on the PVC and remove the row. Used when
   * a user disconnects an account.
   */
  abstract deleteSession(userId: string, sessionId: string): Promise<void>;

  /** Flip status (called by runtime after each tool batch, or by admin UI). */
  abstract setStatus(
    userId: string,
    sessionId: string,
    status: BrowserSessionStatusTypes,
  ): Promise<IBrowserSessionData>;

  /** List sessions visible to userId. */
  abstract findAll(
    filter: IFindBrowserSessionsFilter,
  ): Promise<IBrowserSessionData[]>;

  /** Fetch a single session, scoped to userId. Returns null if not found or not owned. */
  abstract findById(
    userId: string,
    sessionId: string,
  ): Promise<IBrowserSessionData | null>;

  /**
   * Mint a short-lived VNC URL for a session so the user can finish login
   * manually. Returns null if the session is no longer active.
   */
  abstract mintVncUrl(
    userId: string,
    sessionId: string,
  ): Promise<string | null>;

  /**
   * Mark sessions that haven't been touched in `idleMinutes` as expired.
   * Called by a k8s CronJob; profile data on the PVC stays intact so the
   * user can re-login when they come back.
   */
  abstract expireIdleSessions(idleMinutes: number): Promise<number>;
}
