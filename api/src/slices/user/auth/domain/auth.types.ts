import { UnauthorizedException } from '@nestjs/common';
import { IUserData, UserRoleTypes } from '../../user/domain';

export interface IAuthTokenPayload {
  sub: string;
  email: string;
  // Always a singleton `[user.role]` for user tokens. Kept as an array for
  // wire compat with long-lived agent service tokens and embed tokens.
  roles: UserRoleTypes[];
  /**
   * Session id for console tokens (login / register / setup-init / refresh).
   * Absent on agent service, embed and extension tokens. Informational: no
   * guard requires it — revocation lands at the next refresh (research R3).
   */
  sid?: string;
  /**
   * `'embed'` on browser embed tokens minted through `POST /auth/embed/token`
   * (CLEAN-175). The chat verifiers (`BridleChatAuthGuard`, the bridle
   * controller, the `/ws/client` handshake) accept such a token; every
   * platform-side verifier (`JwtAuthGuard`, `A2aCardGuard`) refuses it, so a
   * token rendered into a customer page is worth exactly one thing: chatting
   * as that visitor. Absent on console, agent service and extension tokens.
   */
  typ?: 'embed';
}

/** True for a verified payload that `mintEmbedToken` produced. */
export function isEmbedToken(payload: unknown): boolean {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    (payload as { typ?: unknown }).typ === 'embed'
  );
}

export interface IAuthResult {
  accessToken: string;
  /** Access-token lifetime in seconds at issue time (consoles never parse the JWT). */
  expiresIn: number;
  user: IUserData;
}

/**
 * Machine-readable reasons for a 401. `TOKEN_*` come from the bearer guards,
 * `SESSION_*` from `POST /auth/refresh`. Consoles branch on these (contracts/
 * session-api.md); the human `message` is for logs and curl.
 */
export const AuthErrorCodes = {
  TokenMissing: 'TOKEN_MISSING',
  TokenExpired: 'TOKEN_EXPIRED',
  TokenInvalid: 'TOKEN_INVALID',
  SessionMissing: 'SESSION_MISSING',
  SessionExpired: 'SESSION_EXPIRED',
  SessionInvalid: 'SESSION_INVALID',
} as const;

export type AuthErrorCode =
  (typeof AuthErrorCodes)[keyof typeof AuthErrorCodes];

const AUTH_ERROR_MESSAGES: Record<AuthErrorCode, string> = {
  TOKEN_MISSING: 'Missing access token',
  TOKEN_EXPIRED: 'Access token expired',
  TOKEN_INVALID: 'Invalid access token',
  SESSION_MISSING: 'Missing session',
  SESSION_EXPIRED: 'Session expired',
  SESSION_INVALID: 'Invalid session',
};

/** 401 with an object body `{ code, message }` (same shape as the share-link 403s). */
export function unauthorized(code: AuthErrorCode): UnauthorizedException {
  return new UnauthorizedException({
    code,
    message: AUTH_ERROR_MESSAGES[code],
  });
}

/**
 * Tell an expired token apart from every other verification failure without
 * importing `jsonwebtoken` (only transitive via `@nestjs/jwt`).
 */
export function classifyJwtError(err: unknown): AuthErrorCode {
  const name = (err as { name?: unknown } | null)?.name;
  return name === 'TokenExpiredError'
    ? AuthErrorCodes.TokenExpired
    : AuthErrorCodes.TokenInvalid;
}
