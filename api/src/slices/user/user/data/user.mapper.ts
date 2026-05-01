import { Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import {
  IUserData,
  ICreateUserData,
  UserRoleTypes,
  ALL_USER_ROLES,
} from '../domain';

const VALID_ROLES = new Set<string>(ALL_USER_ROLES);

@Injectable()
export class UserMapper {
  toEntity(record: User): IUserData {
    return {
      id: record.id,
      name: record.name,
      email: record.email,
      roles: this.normalizeRoles(record.roles),
      status: record.status as IUserData['status'],
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  toCreate(data: ICreateUserData & { password: string }) {
    return {
      id: `user-${crypto.randomUUID()}`,
      name: data.name,
      email: data.email.toLowerCase(),
      password: data.password,
      roles: this.normalizeRoles(data.roles ?? [UserRoleTypes.User]),
      status: 'invited',
    };
  }

  /** Drop unknown values, dedupe, fall back to ['User'] when empty. */
  normalizeRoles(roles: readonly string[] | null | undefined): UserRoleTypes[] {
    if (!roles?.length) return [UserRoleTypes.User];
    const filtered = Array.from(
      new Set(roles.filter((r): r is UserRoleTypes => VALID_ROLES.has(r))),
    ) as UserRoleTypes[];
    return filtered.length ? filtered : [UserRoleTypes.User];
  }
}
