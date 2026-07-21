import type {
  CreateUserDto,
  UpdateUserDto,
} from '#api/data/repositories/api/types.gen';
import {
  UserRoleTypes,
  UserStatusTypes,
  type ICreateUserData,
  type IUpdateUserData,
  type IUserData,
} from '../domain/user.types';

const ROLE_VALUES = new Set<string>(Object.values(UserRoleTypes));
const STATUS_VALUES = new Set<string>(Object.values(UserStatusTypes));

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Maps the users API onto domain shapes. The generated wire enums share the
 * domain enums' string values but not their TS identity, so role/status arrays
 * are cast at the DTO boundary.
 */
export class UserMapper {
  toEntity(raw: unknown): IUserData | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    if (typeof o.id !== 'string') return null;
    return {
      id: o.id,
      name: str(o.name),
      email: str(o.email),
      roles: this.toRoles(o.roles),
      status: this.toStatus(o.status),
      createdAt: str(o.createdAt),
    };
  }

  toList(raw: unknown): IUserData[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) => this.toEntity(item))
      .filter((u): u is IUserData => u !== null);
  }

  toCreateDto(input: ICreateUserData): CreateUserDto {
    return {
      name: input.name,
      email: input.email,
      password: input.password,
      roles: input.roles as unknown as CreateUserDto['roles'],
    };
  }

  toUpdateDto(input: IUpdateUserData): UpdateUserDto {
    return {
      name: input.name,
      email: input.email,
      password: input.password,
      status: input.status as unknown as UpdateUserDto['status'],
    };
  }

  toRolesBody(roles: UserRoleTypes[]): NonNullable<CreateUserDto['roles']> {
    return roles as unknown as NonNullable<CreateUserDto['roles']>;
  }

  private toRoles(raw: unknown): UserRoleTypes[] {
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (r): r is UserRoleTypes => typeof r === 'string' && ROLE_VALUES.has(r),
    );
  }

  private toStatus(raw: unknown): UserStatusTypes {
    return typeof raw === 'string' && STATUS_VALUES.has(raw)
      ? (raw as UserStatusTypes)
      : UserStatusTypes.Active;
  }
}
