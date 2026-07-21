import {
  UserRoleTypes,
  type IAuthSession,
  type IAuthUser,
} from '../domain/auth.types';

const EMPTY_USER: IAuthUser = {
  id: '',
  name: '',
  email: '',
  roles: [],
  status: '',
};

const VALID_ROLES = new Set<string>(Object.values(UserRoleTypes));

/**
 * Maps the (untyped) auth responses onto domain shapes. Reads defensively and
 * keeps only recognized roles so an unexpected backend value can't crash the
 * role checks.
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
      roles: this.toRoles(o.roles),
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

  private toRoles(raw: unknown): UserRoleTypes[] {
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (r): r is UserRoleTypes => typeof r === 'string' && VALID_ROLES.has(r),
    );
  }
}
