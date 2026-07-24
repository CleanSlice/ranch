import {
  BadRequestException,
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

type DurationString = `${number}${'s' | 'm' | 'h' | 'd'}`;

const ADMIN_EMBED_MAX_TTL: DurationString = '7d';

const DURATION_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

function durationToMs(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value);
  if (!match) {
    throw new BadRequestException(`Invalid duration: ${value}`);
  }
  return Number(match[1]) * DURATION_MS[match[2]];
}

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

    // Invited accounts are activated by their first successful sign-in —
    // there is no separate accept-invite flow.
    let current = record;
    if (current.status === 'invited') {
      current = await this.prisma.user.update({
        where: { id: current.id },
        data: { status: 'active' },
      });
    }

    return this.issueToken(this.mapper.toEntity(current));
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
          role: UserRoleTypes.User,
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
      roles: [user.role],
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
   * Mint a short-lived browser embed JWT for the bridle widget. Strips
   * `Owner` and `Admin` roles from what was requested — an embed:mint API
   * key cannot escalate a visitor to platform admin even if the caller
   * passes those roles in the body. Keys carrying the `embed:mint-admin`
   * scope set `allowAdminRoles` at the controller: the roles are then kept
   * verbatim, but the TTL falls under the same cap as admin embed tokens —
   * the long-lived credential must stay the server-side key, never the
   * browser JWT.
   */
  async mintEmbedToken(claims: {
    sub: string;
    email?: string;
    roles?: UserRoleTypes[];
    expiresIn?: string;
    allowAdminRoles?: boolean;
  }): Promise<{ token: string; expiresAt: Date }> {
    const roles = claims.allowAdminRoles
      ? (claims.roles ?? [])
      : (claims.roles ?? []).filter(
          (r) => r !== UserRoleTypes.Owner && r !== UserRoleTypes.Admin,
        );
    const isAdminToken = roles.some(
      (r) => r === UserRoleTypes.Owner || r === UserRoleTypes.Admin,
    );
    const expiresIn = (claims.expiresIn ?? '15m') as DurationString;
    if (isAdminToken && durationToMs(expiresIn) > durationToMs(ADMIN_EMBED_MAX_TTL)) {
      throw new BadRequestException(
        `expiresIn exceeds the ${ADMIN_EMBED_MAX_TTL} maximum for admin embed tokens`,
      );
    }
    const payload: IAuthTokenPayload = {
      sub: claims.sub,
      email: claims.email ?? '',
      roles,
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
