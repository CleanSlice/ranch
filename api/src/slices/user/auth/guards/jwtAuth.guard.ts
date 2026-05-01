import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { IAuthTokenPayload } from '../domain/auth.types';
import { PUBLIC_METADATA_KEY } from './public.decorator';

/**
 * Verifies the `Authorization: Bearer <token>` header, decodes the JWT and
 * stores the payload on `req.user` so downstream code (controllers, RolesGuard)
 * can consume it. Throws 401 on missing or invalid tokens.
 *
 * Routes tagged with @Public() bypass this check entirely.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
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
      throw new UnauthorizedException('Missing access token');
    }
    try {
      req.user = this.jwt.verify<IAuthTokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    return true;
  }
}
