import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import {
  AuthErrorCodes,
  classifyJwtError,
  IAuthTokenPayload,
  unauthorized,
} from '../domain/auth.types';
import { PUBLIC_METADATA_KEY } from './public.decorator';

/**
 * Verifies the `Authorization: Bearer <token>` header, decodes the JWT and
 * stores the payload on `req.user` so downstream code (controllers, RolesGuard)
 * can consume it. Throws 401 with a machine-readable `code`:
 * `TOKEN_MISSING`, `TOKEN_EXPIRED` (consoles renew and retry once) or
 * `TOKEN_INVALID` (consoles renew once, then end the session).
 *
 * Stateless on purpose: the `sid` claim is never looked up here, so agent
 * service tokens (no session) keep passing and ordinary requests cost no
 * database work. Revocation lands at the next refresh (research R3).
 *
 * Routes tagged with @Public() bypass this check entirely.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private jwt: JwtService,
    private reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      PUBLIC_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) return true;

    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: IAuthTokenPayload }>();
    const header = req.headers.authorization ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw unauthorized(AuthErrorCodes.TokenMissing);
    }
    try {
      req.user = this.jwt.verify<IAuthTokenPayload>(token);
    } catch (err) {
      const code = classifyJwtError(err);
      // Never the token itself; the subject is enough to trace a report.
      this.logger.warn(
        `Rejected bearer (${code}) sub=${this.subjectOf(token) ?? '?'} ${req.method} ${req.url}`,
      );
      throw unauthorized(code);
    }
    return true;
  }

  private subjectOf(token: string): string | undefined {
    try {
      const decoded = this.jwt.decode<{ sub?: string } | null>(token);
      return decoded?.sub;
    } catch {
      return undefined;
    }
  }
}
