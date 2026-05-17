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
   *
   * `loginUrl` is the page the gateway navigates Chrome to at warm-up so
   * the VNC view isn't a blank Xvfb desktop. Defaults to `about:blank` —
   * useful for "Add account" in the admin UI when the agent already
   * surfaced the right URL elsewhere.
   */
  abstract openSession(
    userId: string,
    accountKey: string,
    loginUrl?: string,
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

  /**
   * Extract cookies from the live Chrome attached to this session in
   * Playwright `storageState.cookies` shape. Called after an interactive
   * VNC login so the runtime can drop the result straight into its local
   * profile state file and run subsequent automation locally.
   */
  abstract harvestStorageState(
    userId: string,
    sessionId: string,
  ): Promise<{
    cookies: Array<{
      name: string;
      value: string;
      domain: string;
      path: string;
      expires: number;
      httpOnly: boolean;
      secure: boolean;
      sameSite: 'Strict' | 'Lax' | 'None';
    }>;
    origins: Array<{
      origin: string;
      localStorage: Array<{ name: string; value: string }>;
    }>;
  }>;

  /**
   * Drop a Playwright-shaped storageState into the target agent's S3
   * prefix so the runtime sees `<agentDir>/browser-state/<userId>-<profile>.json`
   * on its next sync tick. Called by the Chrome extension import flow:
   * the user logs in to a site in their normal browser, the extension
   * reads cookies via the chrome.cookies API, and posts them here.
   *
   * Returns the relative path so the caller can echo it back to the
   * extension UI.
   */
  abstract importStorageState(
    rancherUserId: string,
    agentId: string,
    userId: string,
    profile: string,
    cookies: unknown[],
    origins?: unknown[],
    userAgent?: string,
  ): Promise<{ path: string; cookies: number }>;
}
