import { createHash, randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthErrorCodes, unauthorized } from '#/user/auth/domain/auth.types';
import { ISessionGateway } from './session.gateway';
import {
  ISessionConfig,
  ISessionCookieOptions,
  ISessionData,
  ISessionIssue,
  SESSION_COOKIE_PATH,
  SESSION_SECRET_BYTES,
  SESSION_SECRET_PREFIX,
} from './session.types';

const DAY_MS = 86_400_000;
/** Revoked rows are kept this long for diagnostics, then pruned. */
const REVOKED_RETENTION_MS = 30 * DAY_MS;

const DEFAULT_IDLE_DAYS = 7;
const DEFAULT_ABSOLUTE_DAYS = 30;

export interface ISessionRefreshResult {
  session: ISessionData;
  cookieMaxAgeSeconds: number;
}

/**
 * Server-side console sessions (research §3.2). The cookie value is an
 * opaque secret; only its SHA-256 is stored, so a database leak cannot hand
 * out live sessions. No rotation on refresh: tabs share one cookie and must
 * not race each other.
 */
@Injectable()
export class SessionService {
  constructor(
    private gateway: ISessionGateway,
    private configService: ConfigService,
  ) {}

  config(): ISessionConfig {
    return {
      idleDays: this.readDays('SESSION_IDLE_DAYS', DEFAULT_IDLE_DAYS),
      absoluteDays: this.readDays(
        'SESSION_ABSOLUTE_DAYS',
        DEFAULT_ABSOLUTE_DAYS,
      ),
      cookieSecure:
        String(this.configService.get('SESSION_COOKIE_SECURE') ?? 'true')
          .trim()
          .toLowerCase() !== 'false',
    };
  }

  async create(
    userId: string,
    userAgent?: string | null,
  ): Promise<ISessionIssue> {
    const { idleDays, absoluteDays } = this.config();
    const now = Date.now();
    const secret = this.mint();
    const session = await this.gateway.create({
      userId,
      secretHash: this.hash(secret),
      expiresAt: new Date(now + idleDays * DAY_MS),
      absoluteExpiresAt: new Date(now + absoluteDays * DAY_MS),
      userAgent: userAgent ? userAgent.slice(0, 256) : null,
    });
    return {
      sessionId: session.id,
      secret,
      cookieMaxAgeSeconds: this.idleSeconds(idleDays),
    };
  }

  /**
   * Validate the cookie secret and slide the inactivity window. Throws a 401
   * with a `SESSION_*` code; the reasons are separated for logs, but a caller
   * cannot tell "unknown" from "revoked" beyond expired-vs-invalid.
   */
  async refresh(secret: string): Promise<ISessionRefreshResult> {
    if (!secret) throw unauthorized(AuthErrorCodes.SessionMissing);
    if (!secret.startsWith(SESSION_SECRET_PREFIX)) {
      throw unauthorized(AuthErrorCodes.SessionInvalid);
    }
    const found = await this.gateway.findByHash(this.hash(secret));
    if (!found) throw unauthorized(AuthErrorCodes.SessionInvalid);
    if (!this.isLive(found)) throw unauthorized(AuthErrorCodes.SessionExpired);

    const { idleDays } = this.config();
    const session = await this.gateway.touch(
      found.id,
      new Date(Date.now() + idleDays * DAY_MS),
    );
    return { session, cookieMaxAgeSeconds: this.idleSeconds(idleDays) };
  }

  /** Revoke the session behind a cookie secret. False when nothing live matched. */
  async revoke(secret: string): Promise<boolean> {
    if (!secret || !secret.startsWith(SESSION_SECRET_PREFIX)) return false;
    const found = await this.gateway.findByHash(this.hash(secret));
    if (!found || found.revokedAt) return false;
    await this.gateway.revoke(found.id);
    return true;
  }

  /** Bounded housekeeping, run on login (research R7). */
  async pruneForUser(userId: string): Promise<number> {
    const now = Date.now();
    return this.gateway.pruneForUser(userId, {
      absoluteBefore: new Date(now),
      revokedBefore: new Date(now - REVOKED_RETENTION_MS),
    });
  }

  isLive(session: ISessionData, at: number = Date.now()): boolean {
    return (
      session.revokedAt === null &&
      session.expiresAt.getTime() > at &&
      session.absoluteExpiresAt.getTime() > at
    );
  }

  cookieOptions(maxAgeSeconds: number): ISessionCookieOptions {
    return {
      httpOnly: true,
      sameSite: 'lax',
      path: SESSION_COOKIE_PATH,
      secure: this.config().cookieSecure,
      maxAge: maxAgeSeconds * 1000,
    };
  }

  clearCookieOptions(): ISessionCookieOptions {
    return { ...this.cookieOptions(0), maxAge: 0 };
  }

  private mint(): string {
    return `${SESSION_SECRET_PREFIX}${randomBytes(SESSION_SECRET_BYTES).toString('base64url')}`;
  }

  private hash(secret: string): string {
    return createHash('sha256').update(secret).digest('hex');
  }

  private idleSeconds(idleDays: number): number {
    return Math.max(1, Math.round((idleDays * DAY_MS) / 1000));
  }

  private readDays(key: string, fallback: number): number {
    const raw = this.configService.get<string>(key);
    const parsed = raw === undefined || raw === '' ? NaN : Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
}
