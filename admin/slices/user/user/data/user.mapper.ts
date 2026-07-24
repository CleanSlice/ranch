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
 * domain enums' string values but not their TS identity, so role/status values
 * are cast at the DTO boundary.
 */
export class UserMapper {
  toEntity(raw: unknown): IUserData | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    if (typeof o.id !== 'string') return null;
    const name = str(o.name);
    return {
      id: o.id,
      name,
      email: str(o.email),
      initials: this.toInitials(name),
      role: this.toRole(o.role),
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
      role: input.role as unknown as CreateUserDto['role'],
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

  toRoleBody(role: UserRoleTypes): NonNullable<CreateUserDto['role']> {
    return role as unknown as NonNullable<CreateUserDto['role']>;
  }

  private toRole(raw: unknown): UserRoleTypes {
    return typeof raw === 'string' && ROLE_VALUES.has(raw)
      ? (raw as UserRoleTypes)
      : UserRoleTypes.User;
  }

  private toStatus(raw: unknown): UserStatusTypes {
    return typeof raw === 'string' && STATUS_VALUES.has(raw)
      ? (raw as UserStatusTypes)
      : UserStatusTypes.Active;
  }

  private toInitials(name: string): string {
    return name
      .split(' ')
      .filter(Boolean)
      .map((p) => p[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  }
}
