import { UnauthorizedException } from '@nestjs/common';
import { IUserData, ROLE_LEVELS, UserRoleTypes } from '../../user/domain';

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
  /**
   * `'acting'` on the token the hub mints with each message of a signed-in
   * console person (CLEAN-232, `ActingPartyService`). It says "this tool call
   * is made for that person" and nothing else: every verifier of a bearer
   * refuses it, and only the MCP tool layer reads it, from the call's
   * `_meta`, never from the `Authorization` header.
   */
  typ?: 'embed' | 'acting';
  /**
   * Acting tokens only: `agent:<id>` of the one agent the token was minted
   * for. A token carried to another agent's runtime is refused.
   */
  aud?: string;
}

/** True for a verified payload that `mintEmbedToken` produced. */
export function isEmbedToken(payload: unknown): boolean {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    (payload as { typ?: unknown }).typ === 'embed'
  );
}

/** True for a verified payload that `ActingPartyService.mint` produced. */
export function isActingToken(payload: unknown): boolean {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    (payload as { typ?: unknown }).typ === 'acting'
  );
}

/**
 * Who a tool call is made for (CLEAN-232). An agent's token says what the
 * agent may do at most; the party says on whose behalf it is doing it, and
 * the API grants the lesser of the two (`#/mcp/tooling`).
 *
 * - `person`: a signed-in console account, proven by an acting token or by
 *   the person's own console token. The role is the one in the database.
 * - `trusted`: the agent speaking for itself (a scheduled job, an
 *   administrator its own configuration names). Bounded by the agent's token.
 * - `guest`: everyone else, and every call that names nobody.
 */
export type ICallerParty =
  | { kind: 'person'; userId: string; role: UserRoleTypes }
  | { kind: 'trusted' }
  | { kind: 'guest' };

/** The roles a person can hold. `Agent` is not one. */
const PERSON_ROLES: readonly UserRoleTypes[] = [
  UserRoleTypes.Owner,
  UserRoleTypes.Admin,
  UserRoleTypes.User,
];

/**
 * The strongest person role in a list of roles, or null when it holds none.
 * One definition for the two places that turn a console token into a person:
 * `ActingPartyService.resolve` and the fallback in `#/mcp/tooling`.
 */
export function highestPersonRole(
  roles: readonly unknown[] | null | undefined,
): UserRoleTypes | null {
  if (!Array.isArray(roles)) return null;
  let best: UserRoleTypes | null = null;
  for (const role of PERSON_ROLES) {
    if (!roles.includes(role)) continue;
    if (best === null || ROLE_LEVELS[role] > ROLE_LEVELS[best]) best = role;
  }
  return best;
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
