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

const ADMIN_EMBED_DEFAULT_TTL: DurationString = '12h';
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

  /**
   * Re-issue the calling Owner/Admin's identity as a short-lived embed JWT
   * for the bridle widget. Unlike mintEmbedToken (API-key path, admin roles
   * stripped), this is reachable only by a logged-in Owner/Admin — guarded
   * at the controller — and keeps the caller's roles, so the hub routes the
   * chat to the `admin` client channel and the agent treats the peer as its
   * operator. TTL is deliberately capped: the token ends up in page markup,
   * and a leaked admin token IS admin access to the agent.
   */
  async mintAdminEmbedToken(
    caller: IAuthTokenPayload,
    expiresIn?: string,
  ): Promise<{ token: string; expiresAt: Date }> {
    const requested = (expiresIn ?? ADMIN_EMBED_DEFAULT_TTL) as DurationString;
    if (durationToMs(requested) > durationToMs(ADMIN_EMBED_MAX_TTL)) {
      throw new BadRequestException(
        `expiresIn exceeds the ${ADMIN_EMBED_MAX_TTL} maximum for admin embed tokens`,
      );
    }
    const payload: IAuthTokenPayload = {
      sub: caller.sub,
      email: caller.email,
      roles: caller.roles,
    };
    const token = await this.jwt.signAsync(payload, { expiresIn: requested });
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
