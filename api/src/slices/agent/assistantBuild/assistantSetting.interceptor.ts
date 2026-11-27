import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable, from, switchMap } from 'rxjs';
import {
  assistantSettingSource,
  withApprovedSettings,
  withLiveSettings,
  type SettingOverrides,
} from '#/setting/domain';
import type { IAuthTokenPayload } from '#/user/auth/domain/auth.types';

const AGENT_SUB = 'agent:';

/**
 * Every HTTP request says how it reads settings (CLEAN-271): APPROVED when
 * it is made for the Ranch assistant, LIVE otherwise. A request that got
 * past this without saying reads approved (`settingScope.ts`), so the
 * question here is only which requests may read live.
 *
 * "Made for the assistant" is not read off a parameter's name. The
 * assistant is named by its id wherever a request can carry one: as the
 * bearer of its runtime's token (its tools over MCP, a knowledge query, an
 * attachment), in any route parameter, in the query, or anywhere in the
 * body (a tool call made with a person's own token names it in the
 * arguments; a route may take `agentId` in its JSON). So the request is the
 * assistant's when the id is its bearer's or appears in any of those. A
 * request is the assistant's too when it MIGHT be and cannot be read: a
 * body that is not parsed JSON is not searched, and its route parameters
 * are what names the agent there.
 *
 * Cheap on purpose: while nothing differs from what the Owner approved
 * (the table is empty) the request is declared live at once, and which
 * agent the assistant is is not even asked.
 *
 * Work outside an HTTP request (the hub's socket handlers, scheduled jobs)
 * does not pass here. It either says whom it serves (`servingAgentId`, as
 * the deploy path does) or reads approved.
 */
@Injectable()
export class AssistantSettingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const source = assistantSettingSource();
    if (context.getType() !== 'http' || !source) return next.handle();
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: IAuthTokenPayload }>();

    return from(
      (async (): Promise<SettingOverrides | null> => {
        const overrides = await source.overrides();
        if (overrides.size === 0) return null;
        const assistantId = await source.assistantId();
        return assistantId && namesAgent(req, assistantId) ? overrides : null;
      })(),
    ).pipe(
      switchMap(
        (overrides) =>
          // The handler runs when it is subscribed to, so the subscription
          // is what has to happen inside the scope.
          new Observable<unknown>((subscriber) => {
            const run = () => next.handle().subscribe(subscriber);
            return overrides
              ? withApprovedSettings(overrides, run)
              : withLiveSettings(run);
          }),
      ),
    );
  }
}

/**
 * Whether `req` is made for the agent `agentId`: it carries that agent's
 * runtime token, or names the id in a route parameter, the query or the
 * body, under any name.
 */
export function namesAgent(
  req: (Request & { user?: IAuthTokenPayload }) | undefined,
  agentId: string,
): boolean {
  if (!req || !agentId) return false;
  const sub = typeof req.user?.sub === 'string' ? req.user.sub : '';
  if (sub === `${AGENT_SUB}${agentId}`) return true;
  return [req.params, req.query, req.body].some((part) =>
    mentions(part, agentId),
  );
}

function mentions(part: unknown, agentId: string): boolean {
  if (part === null || part === undefined) return false;
  if (typeof part === 'string') return part.includes(agentId);
  if (typeof part !== 'object') return false;
  try {
    return JSON.stringify(part).includes(agentId);
  } catch {
    // Something that cannot be read cannot be ruled out.
    return true;
  }
}
