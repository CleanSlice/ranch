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
  /**
   * The console login behind a `jwt` requester — the JWT `sub` and email.
   * `clientId` folds owners and admins into `admin` for a shared history;
   * this keeps them apart where it matters (per-person MCP tokens,
   * CLEAN-80). Absent for share visitors and anonymous callers.
   */
  user?: { id: string; email?: string };
  /**
   * Set only when the bearer was a person's own console token: what the hub
   * needs to mint an acting token for the message (CLEAN-232). An embed
   * token is a `jwt` requester too and has none.
   */
  console?: IConsoleSession;
}

/** A signed-in console person, as their own access token states it. */
export interface IConsoleSession {
  userId: string;
  /** The console session the token belongs to (`sid`). */
  sid: string;
  /** Strongest role on the token. For display; the API re-reads it. */
  role: string;
}

const CONSOLE_ROLES = ['Owner', 'Admin', 'User'] as const;

/**
 * The console session behind a verified JWT payload, or null when the token
 * is not a person's own console token: an embed token (`typ`), an agent
 * service token (`sub = agent:…`), or anything without a session id. Only
 * such a token may have an acting token minted from it; the session and the
 * account are checked again when that token is used.
 */
export function consoleSessionOf(
  payload: Record<string, unknown> | null | undefined,
): IConsoleSession | null {
  if (!payload || payload.typ !== undefined) return null;
  const sub = payload.sub;
  const sid = payload.sid;
  if (typeof sub !== 'string' || !sub || sub.startsWith('agent:')) return null;
  if (typeof sid !== 'string' || !sid) return null;
  const roles = Array.isArray(payload.roles)
    ? (payload.roles as unknown[])
    : [];
  const role = CONSOLE_ROLES.find((r) => roles.includes(r));
  if (!role) return null;
  return { userId: sub, sid, role };
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

// ── Client ids nobody outside may choose (CLEAN-232) ────────
//
// A client id travels to the agent runtime as the sender of the message,
// and a few of them mean something there or here: `admin` is the
// conversation every Owner and Admin shares, `cron` and `heartbeat` are the
// names the runtime gives the turns it starts for itself, `agent:<id>` is an
// agent's own service token, and `peer:<agent>:<context>` is a task another
// agent handed over. The hub mints those itself or not at all. The runtime no
// longer trusts a turn for its sender's name; this is the second lock, on
// the side that hands the name out.

/** Whole ids the hub keeps. */
export const RESERVED_CLIENT_IDS = ['admin', 'cron', 'heartbeat'] as const;

/** Namespaces the hub keeps. */
export const RESERVED_CLIENT_PREFIXES = [
  'agent:',
  'peer:',
  'handover:',
] as const;

/**
 * Whether `id` is one an anonymous, share or embed identity must never be
 * given. Case and outer spaces aside, so `Cron` and ` cron ` are refused too:
 * nothing legitimate is named that way.
 */
export function isReservedClientId(id: string): boolean {
  const wanted = id.trim().toLowerCase();
  return (
    RESERVED_CLIENT_IDS.some((reserved) => wanted === reserved) ||
    RESERVED_CLIENT_PREFIXES.some((prefix) => wanted.startsWith(prefix))
  );
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
 *
 * An agent's service token (`sub = agent:<id>`) is never `admin`, whatever
 * roles it carries (CLEAN-232). The Ranch admin agent's token carries Owner,
 * and its runtime can print it: read as an administrator here, it could read
 * and write the conversation every Owner and Admin shares. It is an `Agent`
 * on routes and a guest at the tools; here it is its own client, with a
 * history of its own that nobody else's token opens.
 *
 * A `sub` that is a reserved client id is unusable too (CLEAN-232): a token
 * that is not an admin's never becomes `admin`, `cron`, `heartbeat` or a
 * `peer:` task by naming itself so. `agent:<id>` is the one reserved
 * namespace a token may carry, and only an agent's own service token: an
 * embed token (`typ`) whose `sub` starts with `agent:` proves nothing.
 */
export function clientIdFromJwtPayload(
  payload: Record<string, unknown> | null | undefined,
): { clientId: string; isAdmin: boolean } | null {
  const sub = payload?.sub;
  const isAgent = typeof sub === 'string' && sub.startsWith('agent:');
  const roles = payload?.roles as string[] | undefined;
  const isAdmin =
    !isAgent &&
    Array.isArray(roles) &&
    (roles.includes('Owner') || roles.includes('Admin'));
  if (isAdmin) return { clientId: 'admin', isAdmin: true };

  if (typeof sub !== 'string' || !sub) return null;
  const ownServiceToken = isAgent && payload?.typ === undefined;
  if (!ownServiceToken && isReservedClientId(sub)) return null;
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
