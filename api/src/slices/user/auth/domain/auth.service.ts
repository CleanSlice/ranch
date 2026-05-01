import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '#/setup/prisma/prisma.service';
import { ISettingGateway } from '#/setting/domain';
import { UserMapper } from '../../user/data/user.mapper';
import { IUserData, UserRoleTypes } from '../../user/domain';
import { IAuthResult, IAuthTokenPayload } from './auth.types';

const BCRYPT_ROUNDS = 10;

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private mapper: UserMapper,
    private jwt: JwtService,
    private settings: ISettingGateway,
  ) {}

  async login(email: string, password: string): Promise<IAuthResult> {
    const record = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!record) throw new UnauthorizedException('Invalid credentials');

    const passwordMatch = await bcrypt.compare(password, record.password);
    if (!passwordMatch) throw new UnauthorizedException('Invalid credentials');

    if (record.status === 'disabled') {
      throw new UnauthorizedException('Account disabled');
    }

    return this.issueToken(this.mapper.toEntity(record));
  }

  async register(
    name: string,
    email: string,
    password: string,
  ): Promise<IAuthResult> {
    const enabled = await this.isRegistrationEnabled();
    if (!enabled) {
      throw new ForbiddenException('Registration is disabled');
    }

    const normalizedEmail = email.toLowerCase();
    const existing = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const hashed = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const created = await this.prisma.user.create({
      data: {
        ...this.mapper.toCreate({
          name,
          email: normalizedEmail,
          password: hashed,
          roles: [UserRoleTypes.User],
        }),
        status: 'active',
      },
    });

    return this.issueToken(this.mapper.toEntity(created));
  }

  async me(userId: string): Promise<IUserData> {
    const record = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!record) throw new NotFoundException('User not found');
    if (record.status === 'disabled') {
      throw new UnauthorizedException('Account disabled');
    }
    return this.mapper.toEntity(record);
  }

  private async issueToken(user: IUserData): Promise<IAuthResult> {
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

  private async isRegistrationEnabled(): Promise<boolean> {
    const setting = await this.settings.findByKey('auth', 'registration_enabled');
    if (!setting) return false;
    const value = setting.value;
    return value === true || value === 'true';
  }
}
