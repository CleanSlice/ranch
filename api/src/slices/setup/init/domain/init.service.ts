import { ConflictException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '#/setup/prisma/prisma.service';
import { UserMapper } from '#/user/user/data/user.mapper';
import { UserRoleTypes } from '#/user/user/domain';
import { IAuthResult, IAuthTokenPayload } from '#/user/auth/domain';

const BCRYPT_ROUNDS = 10;

@Injectable()
export class InitService {
  constructor(
    private prisma: PrismaService,
    private userMapper: UserMapper,
    private jwt: JwtService,
  ) {}

  async getStatus(): Promise<{ requiresInit: boolean }> {
    const ownerCount = await this.prisma.user.count({
      where: { roles: { has: UserRoleTypes.Owner } },
    });
    return { requiresInit: ownerCount === 0 };
  }

  async createOwner(
    name: string,
    email: string,
    password: string,
  ): Promise<IAuthResult> {
    const { requiresInit } = await this.getStatus();
    if (!requiresInit) {
      throw new ConflictException('System already initialized');
    }

    const record = await this.prisma.user.create({
      data: {
        name,
        email: email.toLowerCase(),
        password: await bcrypt.hash(password, BCRYPT_ROUNDS),
        roles: [UserRoleTypes.Owner],
        status: 'active',
      },
    });

    const user = this.userMapper.toEntity(record);
    const payload: IAuthTokenPayload = {
      sub: user.id,
      email: user.email,
      roles: user.roles,
    };

    return {
      accessToken: await this.jwt.signAsync(payload),
      user,
    };
  }
}
