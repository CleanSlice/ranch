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
import type { IRlmJobScope } from '#/rlm/domain/rlm-scope.types';

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

  async issueAgentServiceToken(
    agentId: string,
    isAdmin: boolean,
  ): Promise<string> {
    // Admin agents act as Ranch operators — they hold Owner-equivalent power
    // (they manage the platform itself). Non-admin agents get the Agent role
    // which only opens self-scoped endpoints (`/agents/:id/mcps`, etc.) — they
    // cannot read other agents' data even if they manipulate the URL.
    const payload: IAuthTokenPayload = {
      sub: `agent:${agentId}`,
      email: `agent-${agentId}@ranch.local`,
      roles: isAdmin ? [UserRoleTypes.Owner] : [UserRoleTypes.Agent],
    };
    return this.jwt.signAsync(payload, { expiresIn: '365d' });
  }

  /**
   * Mint a short-lived, self-contained JWT for an RLM executor job pod.
   * No DB registry - the scope claim IS the authorization, re-checked by
   * RlmJobGuard on every internal-context request, which keeps this safe
   * across multiple API replicas. `roles` stays empty: this subject is
   * only ever authorized by RlmJobGuard's scope check, never by
   * role-based guards.
   */
  async issueRlmJobToken(
    scope: IRlmJobScope,
    expiresIn: `${number}${'s' | 'm' | 'h' | 'd'}` = '10m',
  ): Promise<string> {
    const payload: IAuthTokenPayload = {
      sub: `rlm-job:${scope.jobId}`,
      email: '',
      roles: [],
      rlmScope: scope,
    };
    return this.jwt.signAsync(payload, { expiresIn });
  }

  /**
   * Mint a short-lived browser embed JWT for the bridle widget. Strips
   * `Owner` and `Admin` roles regardless of what was requested — an
   * embed:mint API key cannot escalate a visitor to platform admin even
   * if the caller passes those roles in the body.
   */
  async mintEmbedToken(claims: {
    sub: string;
    email?: string;
    roles?: UserRoleTypes[];
    expiresIn?: string;
  }): Promise<{ token: string; expiresAt: Date }> {
    const safeRoles = (claims.roles ?? []).filter(
      (r) => r !== UserRoleTypes.Owner && r !== UserRoleTypes.Admin,
    );
    const expiresIn = (claims.expiresIn ?? '15m') as `${number}${
      | 's'
      | 'm'
      | 'h'
      | 'd'}`;
    const payload: IAuthTokenPayload = {
      sub: claims.sub,
      email: claims.email ?? '',
      roles: safeRoles,
    };
    const token = await this.jwt.signAsync(payload, { expiresIn });
    const decoded = this.jwt.decode(token);
    const expiresAt = new Date((decoded?.exp ?? 0) * 1000);
    return { token, expiresAt };
  }

  private async isRegistrationEnabled(): Promise<boolean> {
    const setting = await this.settings.findByKey(
      'auth',
      'registration_enabled',
    );
    if (!setting) return false;
    const value = setting.value;
    return value === true || value === 'true';
  }
}
