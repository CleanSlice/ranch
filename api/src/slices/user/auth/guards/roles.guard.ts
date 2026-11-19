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
import { PUBLIC_METADATA_KEY } from './public.decorator';
import { ROLES_METADATA_KEY } from './roles.decorator';

/** What a route with no `@Roles` asks for. */
export const DEFAULT_ROUTE_ROLES: readonly UserRoleTypes[] = [
  UserRoleTypes.Admin,
];

const AGENT_SUB_PREFIX = 'agent:';

/**
 * The roles a route asks for: what `@Roles(...)` states on the handler, else
 * on the class, else Admin. An empty `@Roles()` states nothing and is read as
 * the default too, so no spelling of "no role" opens a route.
 */
export function requiredRoles(
  stated: readonly UserRoleTypes[] | null | undefined,
): readonly UserRoleTypes[] {
  return stated?.length ? stated : DEFAULT_ROUTE_ROLES;
}

/**
 * The roles a verified bearer holds on a route.
 *
 * An agent runtime's token (`sub = agent:<id>`) is an `Agent` here and
 * nothing more, whatever roles it carries. The Ranch admin agent's token
 * carries Owner, and the runtime's `exec` tool can print it for any
 * administrator: read as written, that token would let an Admin call every
 * route as the Owner. Its Owner power exists through MCP tools only, where
 * the party the call is made for is checked (`#/mcp/tooling`, CLEAN-232).
 */
export function heldRoles(
  user: Pick<IAuthTokenPayload, 'sub' | 'roles'> | null | undefined,
): readonly UserRoleTypes[] {
  if (!user) return [];
  if (typeof user.sub === 'string' && user.sub.startsWith(AGENT_SUB_PREFIX)) {
    return [UserRoleTypes.Agent];
  }
  return Array.isArray(user.roles) ? user.roles : [];
}

/** Whether a bearer holding `held` passes a route asking for `required`. */
export function rolesAdmit(
  required: readonly UserRoleTypes[],
  held: readonly UserRoleTypes[],
): boolean {
  return required.some((needed) =>
    held.some((actual) => hasAtLeastRole(actual, needed)),
  );
}

/**
 * Every route asks for a role (CLEAN-232). Registered as a global APP_GUARD
 * right after JwtAuthGuard (app.module.ts), so it needs no `@UseGuards` and
 * no route can forget it.
 *
 * `@Roles(...)` lists thresholds (OR-ed): the request passes when the bearer
 * holds a role at or above any of them. Roles are hierarchical (Owner > Admin
 * > User); Agent is exact-match only, in both directions. A route with no
 * `@Roles` asks for Admin: closed to a User and to an agent runtime. Until
 * this, such a route let any valid token through, and 136 of 252 routes had
 * none.
 *
 * `@Public()` routes are skipped, exactly as JwtAuthGuard skips them: there
 * is no bearer to hold a role. That one rule also covers every route a
 * machine calls (the bridle key, an API key, an A2A peer credential, a
 * hand-verified extension or share token), because the JWT guard is global
 * and such a route cannot work without `@Public()`. publicRoutes.spec.ts pins
 * that set; userRoutes.spec.ts and agentRoutes.spec.ts pin the two sets a
 * role opens below Admin.
 *
 * Controllers that still carry `@UseGuards(JwtAuthGuard, RolesGuard)` run
 * this twice. The answer depends on the request and the metadata alone, so
 * the second run changes nothing.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      PUBLIC_METADATA_KEY,
      targets,
    );
    if (isPublic) return true;

    const required = requiredRoles(
      this.reflector.getAllAndOverride<UserRoleTypes[]>(
        ROLES_METADATA_KEY,
        targets,
      ),
    );
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: IAuthTokenPayload }>();
    if (!rolesAdmit(required, heldRoles(req?.user))) {
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }
}
