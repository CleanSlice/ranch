import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { IAuthTokenPayload } from '../domain/auth.types';
import { hasAtLeastRole, UserRoleTypes } from '../../user/domain';
import { ROLES_METADATA_KEY } from './roles.decorator';

/**
 * Pairs with @Roles(...). The decorator lists thresholds (OR-ed): the request
 * is allowed when the JWT carries a role at or above any of them — roles are
 * hierarchical (Owner > Admin > User), Agent is exact-match only. Must run
 * AFTER JwtAuthGuard so that req.user is set.
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
    const allowed = required.some((needed) =>
      userRoles.some((actual) => hasAtLeastRole(actual, needed)),
    );
    if (!allowed) {
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }
}
