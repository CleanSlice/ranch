import { Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import {
  IUserData,
  ICreateUserData,
  UserRoleTypes,
  ALL_USER_ROLES,
  ASSIGNABLE_USER_ROLES,
} from '../domain';

const VALID_ROLES = new Set<string>(ALL_USER_ROLES);
const ASSIGNABLE_ROLES = new Set<string>(ASSIGNABLE_USER_ROLES);

@Injectable()
export class UserMapper {
  toEntity(record: User): IUserData {
    return {
      id: record.id,
      name: record.name,
      email: record.email,
      role: this.toRole(record.role),
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
      role: this.toAssignableRole(data.role),
      status: 'invited',
    };
  }

  /** Any valid enum member (Owner included — stored rows carry it), else User. */
  toRole(role: string | null | undefined): UserRoleTypes {
    return role && VALID_ROLES.has(role)
      ? (role as UserRoleTypes)
      : UserRoleTypes.User;
  }

  /** Only Admin/User can be written through create/update paths, else User. */
  toAssignableRole(role: string | null | undefined): UserRoleTypes {
    return role && ASSIGNABLE_ROLES.has(role)
      ? (role as UserRoleTypes)
      : UserRoleTypes.User;
  }
}
