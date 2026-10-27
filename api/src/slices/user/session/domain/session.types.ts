export const SESSION_SECRET_PREFIX = 'rs_';
export const SESSION_SECRET_BYTES = 32;
export const SESSION_COOKIE_NAME = 'ranch_session';
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
  httpOnly: true;
  sameSite: 'lax';
  path: string;
  secure: boolean;
  maxAge: number;
}
