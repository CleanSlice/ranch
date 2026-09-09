// Domain types for admin auth.

export interface IAuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
}

export interface IAuthState {
  accessToken: string | null;
  /** Epoch ms when the current access token stops being accepted. */
  expiresAt: number | null;
  user: IAuthUser | null;
  /** The session died while the person was working; the in-place dialog is up. */
  sessionEnded: boolean;
  sessionEndedCode: string | null;
}

/**
 * A successful login / refresh result: bearer token, its lifetime in seconds
 * at issue time, and the authenticated user.
 */
export interface IAuthSession {
  accessToken: string;
  expiresIn: number;
  user: IAuthUser;
}
