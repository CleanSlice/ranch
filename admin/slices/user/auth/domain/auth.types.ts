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
  user: IAuthUser | null;
}

/** A successful login result: bearer token + the authenticated user. */
export interface IAuthSession {
  accessToken: string;
  user: IAuthUser;
}
