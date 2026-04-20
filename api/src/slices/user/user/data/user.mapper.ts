import { Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import { IUserData } from '../domain';

@Injectable()
export class UserMapper {
  toEntity(record: User): IUserData {
    return {
      id: record.id,
      name: record.name,
      email: record.email,
      role: record.role as IUserData['role'],
      status: record.status as IUserData['status'],
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
