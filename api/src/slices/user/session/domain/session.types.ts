export const SESSION_SECRET_PREFIX = 'rs_';
export const SESSION_SECRET_BYTES = 32;
/**
 * The consoles a sign-in can belong to (CLEAN-236).
 *
 * Both consoles call one API host, and the session cookie is host-only on
 * that host. Under one name it was one sign-in for both: signing in to the
 * management console as the Owner turned the user console, open in the same
 * browser as a User, into the Owner at its next renewal, and signing out of
 * one ended the other. So a session records the console it was made in, each
 * console has a cookie of its own, and a console says which one it is in a
 * header on every request.
 */
export const SESSION_SURFACES = ['admin', 'app'] as const;
export type SessionSurface = (typeof SESSION_SURFACES)[number];

/** The header a console names itself in. Lower case, as Node hands it over. */
export const SESSION_CONSOLE_HEADER = 'x-ranch-console';

/**
 * The cookie both consoles shared until CLEAN-236. Never read: a session
 * behind it cannot be said to belong to either console. Cleared when seen.
 */
export const LEGACY_SESSION_COOKIE_NAME = 'ranch_session';

/** The cookie of one console's sign-in. */
export function sessionCookieName(surface: SessionSurface): string {
  return `${LEGACY_SESSION_COOKIE_NAME}_${surface}`;
}

/** The console a header value names, or null. There is no default. */
export function sessionSurfaceOf(value: unknown): SessionSurface | null {
  const stated = Array.isArray(value) ? (value[0] as unknown) : value;
  if (typeof stated !== 'string') return null;
  const wanted = stated.trim().toLowerCase();
  return SESSION_SURFACES.find((surface) => surface === wanted) ?? null;
}

/** The cookie is only ever needed by /auth/refresh and /auth/logout. */
export const SESSION_COOKIE_PATH = '/auth';

export interface ISessionData {
  id: string;
  userId: string;
  secretHash: string;
  /** Sliding inactivity deadline — moved forward on every refresh. */
  expiresAt: Date;
  /** Hard ceiling set at creation; never moved. */
  absoluteExpiresAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
  userAgent: string | null;
  /**
   * The console the sign-in was made in. Null on a row from before
   * CLEAN-236, and on a sign-in no console made (a script calling
   * `POST /auth/login` for a token): neither has a cookie, and no console
   * can renew either.
   */
  surface: SessionSurface | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICreateSessionData {
  userId: string;
  secretHash: string;
  expiresAt: Date;
  absoluteExpiresAt: Date;
  userAgent?: string | null;
  /** Null: no console is signing in, and none will be able to renew it. */
  surface: SessionSurface | null;
}

export interface ISessionConfig {
  idleDays: number;
  absoluteDays: number;
  cookieSecure: boolean;
}

/** What the auth layer needs to set the cookie and sign the access token. */
export interface ISessionIssue {
  sessionId: string;
  /** Plaintext cookie value. Returned exactly once, never stored or logged. */
  secret: string;
  cookieMaxAgeSeconds: number;
}

export interface ISessionCookieOptions {
  httpOnly: true;
  sameSite: 'lax';
  path: string;
  secure: boolean;
  maxAge: number;
}
