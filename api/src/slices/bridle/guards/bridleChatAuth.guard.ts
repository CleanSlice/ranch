import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { ShareLinkService } from '#/agent/shareLink/domain';
import type { IAuthTokenPayload } from '#/user/auth/domain/auth.types';

/** What this guard leaves behind for the route handler. */
export interface IChatAuthRequest extends Request {
  /** Set for JWT callers only — share visitors have no user record. */
  user?: IAuthTokenPayload;
  /** Chat identity: `admin`, a JWT `sub`, or `share-<visitorId>`. */
  chatClientId?: string;
}

/**
 * Access control for the two guarded bridle routes (attachment upload and
 * download). Accepts either of the two identities that chat supports:
 *
 *   - a console user's Bearer JWT — verified exactly as `JwtAuthGuard` does,
 *     so existing callers see no change;
 *   - a share-link visitor's `X-Share-Token` + `X-Share-Visitor` pair, checked
 *     against the `agentId` in the path on every request (no cached decision,
 *     so a revoked link stops file traffic immediately — research.md R4).
 *
 * Rejections keep their status codes apart on purpose: missing credentials are
 * 401 (the console's axios interceptor bounces those to /login, which is right
 * for a console user), while a rejected share link is the service's 403 with a
 * `{ code }` body — a 401 there would drop an anonymous visitor into the login
 * form (research.md R4).
 *
 * A bearer token that fails verification does NOT end the request when share
 * headers are also present: a console user whose session expired must still be
 * able to use a share page they opened in the same browser, and this keeps the
 * guard's resolution order identical to `BridleController.resolveClientId`.
 */
@Injectable()
export class BridleChatAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly shareLinks: ShareLinkService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<IChatAuthRequest>();
    const shareToken = headerValue(req.headers['x-share-token']);

    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme?.toLowerCase() === 'bearer' && token) {
      let payload: IAuthTokenPayload | null = null;
      try {
        payload = this.jwt.verify<IAuthTokenPayload>(token);
      } catch {
        // Only fatal when there is nothing else to try — see the class note.
        if (!shareToken) {
          throw new UnauthorizedException('Invalid or expired token');
        }
      }
      if (payload) {
        req.user = payload;
        // Same mapping as `resolveClientId` and the websocket handler: every
        // console admin shares one chat identity, so their history lives in
        // one channel instead of one per account.
        const roles = payload.roles as string[] | undefined;
        const isAdmin =
          Array.isArray(roles) &&
          (roles.includes('Owner') || roles.includes('Admin'));
        req.chatClientId = isAdmin ? 'admin' : payload.sub;
        return true;
      }
    }

    if (shareToken) {
      const visitorId = headerValue(req.headers['x-share-visitor']) ?? '';
      const agentId =
        (req.params as Record<string, string> | undefined)?.agentId ?? '';
      // Throws 403 `{ code }` for a dead/foreign token or a bad visitor id.
      // Never logged: the token is a bearer secret.
      req.chatClientId = await this.shareLinks.authorizeChat(
        shareToken,
        agentId,
        visitorId,
      );
      return true;
    }

    throw new UnauthorizedException('Missing access token');
  }
}

/** Express hands a repeated header through as an array. */
function headerValue(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}
