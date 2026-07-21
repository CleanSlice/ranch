// Domain types for integration sessions (browser-cookie imports).

export type SessionStatusTypes =
  | 'pending'
  | 'connected'
  | 'needs_login'
  | 'revoked';

export interface ISessionData {
  id: string;
  userId: string;
  service: string;
  accountKey: string;
  mechanism: 'browser' | 'secret';
  label: string | null;
  status: SessionStatusTypes;
  createdAt: string;
  updatedAt: string;
}
