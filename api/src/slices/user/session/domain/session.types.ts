export const SESSION_SECRET_PREFIX = 'rs_';
export const SESSION_SECRET_BYTES = 32;
export const SESSION_COOKIE_NAME = 'ranch_session';
/** The cookie is only ever needed by /auth/refresh and /auth/logout. */
export const SESSION_COOKIE_PATH = '/auth';
/**
 * A second, readable cookie that says nothing but "a session exists". The
 * real cookie is httpOnly and scoped to /auth, so a console cannot tell on
 * boot whether asking /auth/refresh is worth a round trip; without this hint
 * every anonymous visit to the landing page ended in a 401 (CLEAN-178). Same
 * lifetime as the session cookie, set and cleared alongside it, no secret.
 */
export const SESSION_HINT_COOKIE_NAME = 'ranch_session_hint';
export const SESSION_HINT_COOKIE_PATH = '/';

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
  createdAt: Date;
  updatedAt: Date;
}

export interface ICreateSessionData {
  userId: string;
  secretHash: string;
  expiresAt: Date;
  absoluteExpiresAt: Date;
  userAgent?: string | null;
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
  /** True for the session cookie, false for the readable hint cookie. */
  httpOnly: boolean;
  sameSite: 'lax';
  path: string;
  secure: boolean;
  maxAge: number;
}
