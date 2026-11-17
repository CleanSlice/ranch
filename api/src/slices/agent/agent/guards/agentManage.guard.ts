import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { IAuthTokenPayload } from '#/user/auth/domain/auth.types';
import { PUBLIC_METADATA_KEY } from '#/user/auth/guards/public.decorator';
import { AgentPermissionService } from '../domain/agentPermission.service';

export const MANAGES_AGENT_METADATA_KEY = 'managesAgent';

/** The route parameters an agent id travels in. */
export type AgentIdParams = 'id' | 'agentId';

/**
 * Marks a route, or a whole controller, as managing ONE agent: the agent
 * named by the given route parameter (CLEAN-232). The role on the route says
 * what kind of account may call it; this says for which agent.
 *
 * `AgentManageGuard` reads it. On a controller it covers every route; a
 * `@Public()` route inside is left alone, because it has no bearer and
 * proves its right some other way (a signed link).
 *
 * manageAgentRoutes.spec.ts pins the set of routes that carry it.
 */
export const ManagesAgent = (param: AgentIdParams) =>
  SetMetadata(MANAGES_AGENT_METADATA_KEY, param);

/** What every agent route answers for an agent that does not exist. */
export const AGENT_NOT_FOUND = 'Agent not found';

/**
 * Applies `AgentPermissionService.canManage` to the routes marked
 * `@ManagesAgent(...)`. Registered once, as a global guard after JwtAuthGuard
 * and RolesGuard (app.module.ts), so a controller states the rule with one
 * decorator and no module has to wire a guard.
 *
 * It answers 404 `Agent not found` both for an agent that does not exist and
 * for one the caller may not manage. The two cases leave through the same
 * line, so an Admin cannot tell the Ranch admin agent's secrets route from a
 * mistyped id, and nobody learns which ids exist. A route with no marker is
 * none of its business.
 */
@Injectable()
export class AgentManageGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permission: AgentPermissionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const param = this.reflector.getAllAndOverride<AgentIdParams | undefined>(
      MANAGES_AGENT_METADATA_KEY,
      targets,
    );
    if (!param) return true;
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_METADATA_KEY, targets)
    ) {
      return true;
    }

    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: IAuthTokenPayload }>();
    const raw: unknown = (req?.params as Record<string, unknown> | undefined)?.[
      param
    ];
    const agentId = typeof raw === 'string' ? raw : '';
    const agent = await this.permission.manageable(
      AgentPermissionService.callerOfBearer(req?.user),
      agentId,
    );
    if (!agent) throw new NotFoundException(AGENT_NOT_FOUND);
    return true;
  }
}
