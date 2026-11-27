import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import {
  highestPersonRole,
  type IAuthTokenPayload,
  type ICallerParty,
} from '#/user/auth/domain/auth.types';
import { PUBLIC_METADATA_KEY } from '#/user/auth/guards/public.decorator';
import {
  AGENT_NOT_FOUND_MESSAGE,
  AgentAccessService,
} from '../domain/agentAccess.service';
import { accessSubject } from '../domain/agentAccess.types';
import {
  AGENT_SCOPED_METADATA_KEY,
  type IAgentScope,
} from './agentScoped.decorator';

const GUEST: ICallerParty = { kind: 'guest' };

/**
 * The caller behind a console request, as the lists read them: a person's
 * own token is that person. Anything else is not a person and is never
 * restricted: an agent runtime's token (`sub = agent:<id>`), an embed or
 * acting token (`typ`), a token that holds no person role.
 */
export function accessCallerOfBearer(
  user:
    | (Pick<IAuthTokenPayload, 'sub' | 'roles'> & { typ?: unknown })
    | null
    | undefined,
): ICallerParty {
  const sub = typeof user?.sub === 'string' ? user.sub : '';
  if (!sub || sub.startsWith('agent:') || user?.typ !== undefined) return GUEST;
  const role = highestPersonRole(user?.roles);
  return role ? { kind: 'person', userId: sub, role } : GUEST;
}

/** The caller of an HTTP request, for handlers that filter or assert. */
export function accessCallerOf(req: object | null | undefined): ICallerParty {
  return accessCallerOfBearer(
    (req as { user?: unknown } | null | undefined)?.user as
      | (Pick<IAuthTokenPayload, 'sub' | 'roles'> & { typ?: unknown })
      | undefined,
  );
}

type ScopedRequest = Request & { user?: IAuthTokenPayload };

function agentIdOf(req: ScopedRequest, scope: IAgentScope): unknown {
  const bag = (value: unknown): Record<string, unknown> =>
    typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : {};
  switch (scope.source) {
    case 'query.agentId':
      return bag(req?.query).agentId;
    case 'body.agentId':
      return bag(req?.body).agentId;
    default:
      return bag(req?.params)[scope.source];
  }
}

/**
 * Applies the access lists to the routes marked `@AgentScoped(...)`
 * (CLEAN-231). Registered once, as a global guard after JwtAuthGuard,
 * RolesGuard and AgentManageGuard (app.module.ts).
 *
 * It answers the route's own "not found" for an agent the caller does not
 * reach, so a hidden agent cannot be told from one that does not exist: for
 * a person the lists apply to, an id that names no agent gets the same 404
 * here, whatever the handler would have done with it. A `@Public()` route
 * is left alone (no bearer, no person), and so is a caller the lists do not
 * apply to (the Owner, an agent runtime): for them an unknown id is the
 * handler's business, as before.
 */
@Injectable()
export class AgentAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: AgentAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const scope = this.reflector.getAllAndOverride<IAgentScope | undefined>(
      AGENT_SCOPED_METADATA_KEY,
      targets,
    );
    if (!scope) return true;
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_METADATA_KEY, targets)
    ) {
      return true;
    }

    const req = context.switchToHttp().getRequest<ScopedRequest>();
    const raw = agentIdOf(req, scope);
    const fromParam = scope.source === 'id' || scope.source === 'agentId';
    const absent = raw === undefined || raw === null || raw === '';
    // An optional filter that was not given names no agent.
    if (absent && !fromParam) return true;

    const caller = accessCallerOf(req);
    // Nobody the lists apply to: the Owner, an agent runtime, no person.
    if (accessSubject(caller) === null) return true;
    // Anything that is not one id (a repeated query key, an object in the
    // body) names no agent this person reaches.
    const agentId = typeof raw === 'string' ? raw : '';
    // Reached AND there: an id that names no agent leaves through the same
    // line as a hidden one, so the two cannot be told apart on any route.
    // A route that returns records about the agent asks the narrower reach:
    // the assistant's are the Owner's (CLEAN-268).
    if (
      agentId &&
      (await (scope.records
        ? this.access.readsExisting(caller, agentId)
        : this.access.reachesExisting(caller, agentId)))
    ) {
      return true;
    }

    const notFound =
      typeof scope.notFound === 'function'
        ? scope.notFound(agentId)
        : (scope.notFound ?? AGENT_NOT_FOUND_MESSAGE);
    throw new NotFoundException(notFound);
  }
}
