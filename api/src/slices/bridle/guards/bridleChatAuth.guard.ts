import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { ShareLinkService } from '#/agent/shareLink/domain';
import {
  AuthErrorCodes,
  classifyJwtError,
  unauthorized,
} from '#/user/auth/domain/auth.types';
import type { IAuthTokenPayload } from '#/user/auth/domain/auth.types';
import {
  clientIdFromJwtPayload,
  hasShareToken,
  parseBearer,
  resolveShareIdentity,
} from '../domain';
import type { ChatHeaders, IChatAuth } from '../domain';

/** What this guard leaves behind for the route handler. */
export interface IChatAuthRequest extends Request {
  /** Set for JWT callers only — share visitors have no user record. */
  user?: IAuthTokenPayload;
  /**
   * The caller's chat identity AND how they proved it. One object, set only
   * on the success paths below, so a handler can never mistake "the guard
   * found nothing" for "a console user with nothing to check".
   */
  chatAuth?: IChatAuth;
}

/**
 * Access control for the two guarded bridle routes (attachment upload and
 * download). Accepts either of the two identities that chat supports:
 *
 *   - a console user's Bearer JWT — verified as `JwtAuthGuard` does, and
 *     additionally required to carry a usable subject: a signed token with no
 *     `sub` and no admin role proves nothing and is treated as invalid rather
 *     than passed on as an empty identity;
 *   - a share-link visitor's `X-Share-Token` + `X-Share-Visitor` pair, checked
 *     against the `agentId` in the path on every request (no cached decision,
 *     so a revoked link stops file traffic immediately — research.md R4). An
 *     empty token header counts as offered and comes back 403, never as an
 *     unauthenticated caller.
 *
 * Rejections keep their status codes apart on purpose: missing or unusable
 * console credentials are 401 with a `{ code }` body (`TOKEN_MISSING`,
 * `TOKEN_EXPIRED`, `TOKEN_INVALID` — the consoles renew and retry on the
 * latter two, CLEAN-72), while a rejected share link is the service's 403 with
 * its own `{ code }` — a 401 there would drop an anonymous visitor into the
 * login form (research.md R4).
 *
 * A bearer token that fails verification does NOT end the request when share
 * headers are also present: a console user whose session expired must still be
 * able to use a share page they opened in the same browser, and this keeps the
 * guard's resolution order identical to `BridleController.resolveRequester`.
 */
@Injectable()
export class BridleChatAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly shareLinks: ShareLinkService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<IChatAuthRequest>();
    const headers = req.headers as ChatHeaders;
    // Read first: it decides whether an unusable bearer token is fatal.
    const shareOffered = hasShareToken(headers);

    const token = parseBearer(headers);
    if (token) {
      const verified = this.verify(token);
      const identity = clientIdFromJwtPayload(verified.payload);
      if (identity) {
        req.user = verified.payload as unknown as IAuthTokenPayload;
        req.chatAuth = { clientId: identity.clientId, kind: 'jwt' };
        return true;
      }
      // Bad signature, expired, or no usable subject — only fatal when there
      // is nothing else to try (see the class note). Expired is reported as
      // such so the console can renew; everything else is TOKEN_INVALID.
      if (!shareOffered) {
        throw unauthorized(
          verified.error
            ? classifyJwtError(verified.error)
            : AuthErrorCodes.TokenInvalid,
        );
      }
    }

    if (shareOffered) {
      // Throws 403 `{ code }` for a dead/foreign/empty token or a bad visitor
      // id. Never logged: the token is a bearer secret.
      // The agent id ALWAYS comes from the matched route, never a header or
      // body — otherwise a visitor could authorize against their own agent
      // and then read someone else's.
      const params = req.params as Record<string, string> | undefined;
      const clientId = await resolveShareIdentity(
        headers,
        params?.agentId ?? '',
        this.shareLinks,
      );
      req.chatAuth = { clientId, kind: 'share' };
      return true;
    }

    throw unauthorized(AuthErrorCodes.TokenMissing);
  }

  private verify(token: string): {
    payload: Record<string, unknown> | null;
    error?: unknown;
  } {
    try {
      return { payload: this.jwt.verify<Record<string, unknown>>(token) };
    } catch (error) {
      return { payload: null, error };
    }
  }
}
