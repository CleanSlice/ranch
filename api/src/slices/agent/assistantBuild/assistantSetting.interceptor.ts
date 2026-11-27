import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable, from, switchMap } from 'rxjs';
import { assistantSettingSource, withSettingOverrides } from '#/setting/domain';
import type { IAuthTokenPayload } from '#/user/auth/domain/auth.types';

/** The route parameters an agent id travels in. */
const AGENT_PARAMS = ['id', 'agentId'] as const;
const AGENT_SUB = 'agent:';

/**
 * A request made for the Ranch assistant reads the settings the Owner
 * approved (CLEAN-271).
 *
 * The deploy path scopes itself (`servingAssistant` in
 * `AgentDeployService`). This covers what the API does for the assistant
 * between deploys, where a live setting would redirect its data: its
 * workspace and secrets read and written through the console
 * (`/agents/:id/...`), and everything its own runtime asks the API for with
 * its token (its tools over MCP, a knowledge query, an attachment).
 *
 * Two cheap questions first, so that a request that cannot concern the
 * assistant costs nothing: does the bearer belong to an agent runtime, or
 * does the route name an agent? Then one read of a table that is empty
 * unless somebody changed a setting the Owner has not applied, and only
 * then which agent the assistant is.
 */
@Injectable()
export class AssistantSettingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: IAuthTokenPayload }>();
    const candidates = candidateAgentIds(req);
    const source = assistantSettingSource();
    if (candidates.length === 0 || !source) return next.handle();

    return from(
      (async () => {
        const overrides = await source.overrides();
        if (overrides.size === 0) return null;
        const assistantId = await source.assistantId();
        return assistantId && candidates.includes(assistantId)
          ? overrides
          : null;
      })(),
    ).pipe(
      switchMap((overrides) =>
        overrides
          ? // The handler runs when it is subscribed to, so the subscription
            // is what has to happen inside the scope.
            new Observable<unknown>((subscriber) =>
              withSettingOverrides(overrides, () =>
                next.handle().subscribe(subscriber),
              ),
            )
          : next.handle(),
      ),
    );
  }
}

/** The agents a request may be made for: its bearer's, and the route's. */
export function candidateAgentIds(
  req: (Request & { user?: IAuthTokenPayload }) | undefined,
): string[] {
  const ids: string[] = [];
  const sub = typeof req?.user?.sub === 'string' ? req.user.sub : '';
  if (sub.startsWith(AGENT_SUB)) ids.push(sub.slice(AGENT_SUB.length));
  const params = (req?.params ?? {}) as Record<string, unknown>;
  for (const name of AGENT_PARAMS) {
    const value = params[name];
    if (typeof value === 'string' && value !== '') ids.push(value);
  }
  return ids;
}
