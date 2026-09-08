import { ConflictException, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '#/setup/prisma/prisma.service';
import { UserMapper } from '#/user/user/data/user.mapper';
import { UserRoleTypes } from '#/user/user/domain';
import { AuthService } from '#/user/auth/domain';
import type { IAuthSessionResult } from '#/user/auth/domain/auth.service';

const BCRYPT_ROUNDS = 10;

@Injectable()
export class InitService {
  constructor(
    private prisma: PrismaService,
    private userMapper: UserMapper,
    private auth: AuthService,
  ) {}

  async getStatus(): Promise<{ requiresInit: boolean }> {
    const ownerCount = await this.prisma.user.count({
      where: { role: UserRoleTypes.Owner },
    });
    return { requiresInit: ownerCount === 0 };
  }

  async createOwner(
    name: string,
    email: string,
    password: string,
    userAgent?: string | null,
  ): Promise<IAuthSessionResult> {
    const { requiresInit } = await this.getStatus();
    if (!requiresInit) {
      throw new ConflictException('System already initialized');
    }

    const record = await this.prisma.user.create({
      data: {
        name,
        email: email.toLowerCase(),
        password: await bcrypt.hash(password, BCRYPT_ROUNDS),
        role: UserRoleTypes.Owner,
        status: 'active',
      },
    });

    // Same minter as login: session cookie + short access token (CLEAN-72).
    return this.auth.issueSession(this.userMapper.toEntity(record), userAgent);
  }
}
