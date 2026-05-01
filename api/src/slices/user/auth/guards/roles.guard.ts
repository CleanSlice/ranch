import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { IAuthTokenPayload } from '../domain/auth.types';
import { UserRoleTypes } from '../../user/domain';
import { ROLES_METADATA_KEY } from './roles.decorator';

/**
 * Pairs with @Roles(...). Allows the request when the JWT carries at least
 * one of the required roles. Must run AFTER JwtAuthGuard so that req.user is set.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRoleTypes[]>(
      ROLES_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) return true;

    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: IAuthTokenPayload }>();
    const userRoles = req.user?.roles ?? [];
    const allowed = required.some((r) => userRoles.includes(r));
    if (!allowed) {
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }
}
