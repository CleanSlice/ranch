import {
  UserRoleTypes,
  type IAuthSession,
  type IAuthUser,
} from '../domain/auth.types';

const EMPTY_USER: IAuthUser = {
  id: '',
  name: '',
  email: '',
  role: UserRoleTypes.User,
  status: '',
};

const VALID_ROLES = new Set<string>(Object.values(UserRoleTypes));

/**
 * Maps the (untyped) auth responses onto domain shapes. Reads defensively and
 * falls back to the lowest role so an unexpected backend value can't crash
 * (or escalate) the role checks.
 */
export class AuthMapper {
  toUser(raw: unknown): IAuthUser | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    if (typeof o.id !== 'string') return null;
    return {
      id: o.id,
      name: typeof o.name === 'string' ? o.name : '',
      email: typeof o.email === 'string' ? o.email : '',
      role: this.toRole(o.role),
      status: typeof o.status === 'string' ? o.status : '',
    };
  }

  toSession(raw: unknown): IAuthSession {
    const o =
      raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    return {
      accessToken: typeof o.accessToken === 'string' ? o.accessToken : '',
      user: this.toUser(o.user) ?? { ...EMPTY_USER },
    };
  }

  private toRole(raw: unknown): UserRoleTypes {
    return typeof raw === 'string' && VALID_ROLES.has(raw)
      ? (raw as UserRoleTypes)
      : UserRoleTypes.User;
  }
}
