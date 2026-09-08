import type { IAuthSession, IAuthUser } from '../domain/auth.types';

const EMPTY_USER: IAuthUser = {
  id: '',
  name: '',
  email: '',
  role: '',
  status: '',
};

/** Access-token lifetime assumed when the API omits `expiresIn` (15 minutes). */
const DEFAULT_EXPIRES_IN_SECONDS = 900;

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
    const expiresIn =
      typeof o.expiresIn === 'number' && Number.isFinite(o.expiresIn) && o.expiresIn > 0
        ? o.expiresIn
        : DEFAULT_EXPIRES_IN_SECONDS;
    return {
      accessToken: str(o.accessToken),
      expiresIn,
      user: this.toUser(o.user) ?? { ...EMPTY_USER },
    };
  }
}
