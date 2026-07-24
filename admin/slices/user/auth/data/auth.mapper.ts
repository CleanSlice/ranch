import type { IAuthSession, IAuthUser } from '../domain/auth.types';

const EMPTY_USER: IAuthUser = {
  id: '',
  name: '',
  email: '',
  role: '',
  status: '',
};

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Maps the (untyped) auth responses onto domain shapes; reads defensively. */
export class AuthMapper {
  toUser(raw: unknown): IAuthUser | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    if (typeof o.id !== 'string') return null;
    return {
      id: o.id,
      name: str(o.name),
      email: str(o.email),
      role: str(o.role),
      status: str(o.status),
    };
  }

  toSession(raw: unknown): IAuthSession {
    const o =
      raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    return {
      accessToken: str(o.accessToken),
      user: this.toUser(o.user) ?? { ...EMPTY_USER },
    };
  }
}
