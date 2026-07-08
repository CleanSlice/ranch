import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import { IAuthTokenPayload } from '#/user/auth/domain';

/**
 * Pairs with JwtAuthGuard (must run after it so req.user is set). Allows
 * only tokens minted by AuthService.issueRlmJobToken - identified by the
 * `rlm-job:` subject prefix, same idiom as `agent:` for agent tokens.
 * The scope claim itself is validated per-field by each controller method
 * (which knowledgeId/sourceId/path was requested vs what's in scope).
 */
@Injectable()
export class RlmJobGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: IAuthTokenPayload }>();
    const sub = req.user?.sub ?? '';
    if (!sub.startsWith('rlm-job:') || !req.user?.rlmScope) {
      throw new ForbiddenException(
        'This endpoint is only callable by an RLM executor job.',
      );
    }
    return true;
  }
}
