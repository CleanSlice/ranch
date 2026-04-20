import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '#/setup/prisma/prisma.service';
import { IUserGateway } from '../domain/user.gateway';
import {
  IUserData,
  ICreateUserData,
  IUpdateUserData,
} from '../domain/user.types';
import { UserMapper } from './user.mapper';

const BCRYPT_ROUNDS = 10;

@Injectable()
export class UserGateway extends IUserGateway {
  constructor(
    private prisma: PrismaService,
    private mapper: UserMapper,
  ) {
    super();
  }

  async findAll(): Promise<IUserData[]> {
    const records = await this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return records.map((r) => this.mapper.toEntity(r));
  }

  async findById(id: string): Promise<IUserData | null> {
    const record = await this.prisma.user.findUnique({ where: { id } });
    return record ? this.mapper.toEntity(record) : null;
  }

  async create(data: ICreateUserData): Promise<IUserData> {
    const record = await this.prisma.user.create({
      data: {
        name: data.name,
        email: data.email.toLowerCase(),
        password: await bcrypt.hash(data.password, BCRYPT_ROUNDS),
        role: data.role ?? 'member',
        status: 'invited',
      },
    });
    return this.mapper.toEntity(record);
  }

  async update(id: string, data: IUpdateUserData): Promise<IUserData> {
    const record = await this.prisma.user.update({
      where: { id },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.email && { email: data.email.toLowerCase() }),
        ...(data.password && {
          password: await bcrypt.hash(data.password, BCRYPT_ROUNDS),
        }),
        ...(data.role && { role: data.role }),
        ...(data.status && { status: data.status }),
      },
    });
    return this.mapper.toEntity(record);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.user.delete({ where: { id } });
  }
}
