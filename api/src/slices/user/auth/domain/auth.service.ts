import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '#/setup/prisma/prisma.service';
import { ISettingGateway } from '#/setting/domain';
import { SessionService } from '#/user/session/domain/session.service';
import { UserMapper } from '../../user/data/user.mapper';
import { IUserData, UserRoleTypes } from '../../user/domain';
import {
  AuthErrorCodes,
  IAuthResult,
  IAuthTokenPayload,
  unauthorized,
} from './auth.types';

const BCRYPT_ROUNDS = 10;

type DurationString = `${number}${'s' | 'm' | 'h' | 'd'}`;

const ADMIN_EMBED_MAX_TTL: DurationString = '7d';
/** Must match the `JwtModule` default in auth.module.ts / init.module.ts. */
const DEFAULT_JWT_EXPIRES_IN: DurationString = '15m';

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

/**
 * A console sign-in: the access token for the body plus the session secret
 * the controller turns into the httpOnly cookie. The secret is never part of
 * the DTO.
 */
export interface IAuthSessionResult extends IAuthResult {
  cookie: { value: string; maxAgeSeconds: number };
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private mapper: UserMapper,
    private jwt: JwtService,
    private settings: ISettingGateway,
    private sessions: SessionService,
    private config: ConfigService,
  ) {}

  async login(
    email: string,
    password: string,
    userAgent?: string | null,
  ): Promise<IAuthSessionResult> {
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

    // Bounded housekeeping instead of a scheduler (research R7).
    await this.sessions.pruneForUser(current.id).catch(() => 0);

    return this.issueSession(this.mapper.toEntity(current), userAgent);
  }

  async register(
    name: string,
    email: string,
    password: string,
    userAgent?: string | null,
  ): Promise<IAuthSessionResult> {
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

    return this.issueSession(this.mapper.toEntity(created), userAgent);
  }

  async me(userId: string): Promise<IUserData> {
    const record = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!record) throw new NotFoundException('User not found');
    if (record.status === 'disabled') {
      throw new UnauthorizedException('Account disabled');
    }
    return this.mapper.toEntity(record);
  }

  /**
   * Renew the access token from the session cookie alone — works whether or
   * not the previous access token has expired. Slides the session's
   * inactivity window; keeps the same secret (no rotation, research §3.2).
   */
  async refresh(secret: string): Promise<IAuthSessionResult> {
    const { session, cookieMaxAgeSeconds } =
      await this.sessions.refresh(secret);

    const record = await this.prisma.user.findUnique({
      where: { id: session.userId },
    });
    if (!record || record.status === 'disabled') {
      throw unauthorized(AuthErrorCodes.SessionInvalid);
    }

    const user = this.mapper.toEntity(record);
    return {
      accessToken: await this.sign(user, session.id),
      expiresIn: this.jwtExpiresInSeconds(),
      user,
      cookie: { value: secret, maxAgeSeconds: cookieMaxAgeSeconds },
    };
  }

  /** Revoke the session behind the cookie. False when nothing live matched. */
  async logout(secret: string): Promise<boolean> {
    return this.sessions.revoke(secret);
  }

  /**
   * The single console-token minter: creates the server-side session and
   * signs an access token bound to it. Used by login, register and the
   * first-run owner bootstrap.
   */
  async issueSession(
    user: IUserData,
    userAgent?: string | null,
  ): Promise<IAuthSessionResult> {
    const issue = await this.sessions.create(user.id, userAgent);
    return {
      accessToken: await this.sign(user, issue.sessionId),
      expiresIn: this.jwtExpiresInSeconds(),
      user,
      cookie: { value: issue.secret, maxAgeSeconds: issue.cookieMaxAgeSeconds },
    };
  }

  /** Configured access-token lifetime in seconds (what `AuthDto.expiresIn` reports). */
  jwtExpiresInSeconds(): number {
    const raw =
      this.config.get<string>('JWT_EXPIRES_IN') ?? DEFAULT_JWT_EXPIRES_IN;
    try {
      return Math.round(durationToMs(raw) / 1000);
    } catch {
      return Math.round(durationToMs(DEFAULT_JWT_EXPIRES_IN) / 1000);
    }
  }

  private sign(user: IUserData, sessionId: string): Promise<string> {
    const payload: IAuthTokenPayload = {
      sub: user.id,
      email: user.email,
      roles: [user.role],
      sid: sessionId,
    };
    return this.jwt.signAsync(payload);
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
    if (
      isAdminToken &&
      durationToMs(expiresIn) > durationToMs(ADMIN_EMBED_MAX_TTL)
    ) {
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
