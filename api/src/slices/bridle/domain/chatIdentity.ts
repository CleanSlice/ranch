/**
 * One definition of "who is talking" for every chat surface — the HTTP message
 * routes, the attachment guard, the transcript routes and the websocket
 * handshake. It used to live in three hand-copied blocks that had already
 * drifted apart (one of them handed out `undefined` as a client id for a
 * signed token with no `sub`), so the rule now has exactly one home.
 *
 * Deliberately free of Nest and of the shareLink slice: it takes a plain
 * headers bag and a structural authorizer, so it can be unit-tested on its own
 * and imported from anywhere in the bridle slice.
 */

/** The share-link header pair. Node lower-cases incoming header names. */
export const SHARE_TOKEN_HEADER = 'x-share-token';
export const SHARE_VISITOR_HEADER = 'x-share-visitor';

/** Express-shaped header bag; a repeated header arrives as an array. */
export type ChatHeaders = Record<string, string | string[] | undefined>;

/**
 * How a caller proved who they are. `anonymous` is the token-less embed
 * visitor the bridle routes have always allowed through.
 */
export type ChatRequesterKinds = 'jwt' | 'share' | 'anonymous';

/** What a guard leaves on the request: always a real, non-empty client id. */
export interface IChatAuth {
  clientId: string;
  kind: 'jwt' | 'share';
}

/**
 * Who is asking to read a stored attachment. `clientId` is null only for the
 * anonymous kind, which owns nothing.
 */
export interface IAttachmentRequester {
  clientId: string | null;
  kind: ChatRequesterKinds;
}

/** The one method this module needs from `ShareLinkService`. Structural on
 *  purpose: the bridle domain does not import the shareLink slice. */
export interface IShareChatAuthorizer {
  authorizeChat(
    token: string,
    agentId: string,
    visitorId: string,
  ): Promise<string>;
}

/** First value of a header that may have been repeated. */
export function headerValue(
  raw: string | string[] | undefined,
): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

/**
 * Whether the caller offered a share token AT ALL. An empty value counts as
 * offered: `X-Share-Token:` with nothing after it must reach `authorizeChat`
 * and come back as a 403, not slip past into the anonymous path.
 */
export function hasShareToken(headers: ChatHeaders | undefined): boolean {
  return headerValue(headers?.[SHARE_TOKEN_HEADER]) !== undefined;
}

/** The bearer token, or null when the header is missing or not a bearer. */
export function parseBearer(headers: ChatHeaders | undefined): string | null {
  const [scheme, token] = (headerValue(headers?.authorization) ?? '').split(
    ' ',
  );
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

/**
 * The chat identity carried by a verified JWT payload: `admin` for owners and
 * admins (they share one channel so their history lives in one place), the
 * `sub` for everyone else.
 *
 * Returns null when the payload proves nothing usable — a signed token with no
 * `sub` and no admin role. Callers MUST treat that as an unusable token rather
 * than letting an `undefined` client id travel on; a request with no identity
 * is exactly the case an ownership check must not be skipped for.
 */
export function clientIdFromJwtPayload(
  payload: Record<string, unknown> | null | undefined,
): { clientId: string; isAdmin: boolean } | null {
  const roles = payload?.roles as string[] | undefined;
  const isAdmin =
    Array.isArray(roles) &&
    (roles.includes('Owner') || roles.includes('Admin'));
  if (isAdmin) return { clientId: 'admin', isAdmin: true };

  const sub = payload?.sub;
  if (typeof sub !== 'string' || !sub) return null;
  return { clientId: sub, isAdmin: false };
}

/**
 * The share visitor's chat identity for this agent, re-validated on every
 * call. Throws the service's 403 (`SHARE_LINK_INVALID` / `SHARE_VISITOR_INVALID`)
 * for a dead, foreign or empty token, or a missing/malformed visitor id — the
 * caller must never degrade that into an anonymous identity. The token is a
 * bearer secret and is never logged.
 */
export function resolveShareIdentity(
  headers: ChatHeaders | undefined,
  agentId: string,
  shareLinks: IShareChatAuthorizer,
): Promise<string> {
  return shareLinks.authorizeChat(
    headerValue(headers?.[SHARE_TOKEN_HEADER]) ?? '',
    agentId,
    headerValue(headers?.[SHARE_VISITOR_HEADER]) ?? '',
  );
}
