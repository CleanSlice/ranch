// Share-link domain contract (CLEAN-66). Pure types + constants: no Prisma,
// no DTOs, no Nest — the mapper converts records, the controllers convert DTOs.

/** Token prefix. Makes a share token recognisable and impossible to confuse
 *  with an API key (`rk_`) or a JWT. */
export const SHARE_TOKEN_PREFIX = 'sl_';

/** Entropy of the secret: 32 random bytes ⇒ 43 base64url chars (~256 bits). */
export const SHARE_TOKEN_BYTES = 32;

/** Chat identity prefix for share visitors. Guarantees no collision with a
 *  JWT `sub`, `admin`, `anon-…`, `http-…` or `sync-…` client id, which is what
 *  makes share conversations distinguishable in the chat history (FR-012). */
export const SHARE_CLIENT_PREFIX = 'share-';

/** Same rule as the existing `sanitizeAnonId` in the bridle websocket handler:
 *  a visitor id is opaque, url-safe and short. */
export const SHARE_VISITOR_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** One persisted share-link row. Dates are ISO strings — the domain never
 *  handles `Date` instances so the state can be serialised as-is. */
export interface IShareLinkData {
  id: string;
  agentId: string;
  token: string;
  /** null ⇒ active. */
  revokedAt: string | null;
  /** null until the token has been replaced at least once. */
  rotatedAt: string | null;
  rotationCount: number;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

/** Owner-facing view of the link. `token` is exposed only while the link is
 *  active — a revoked token is dead and must never be shown or reused. */
export interface IShareLinkState {
  active: boolean;
  token: string | null;
  createdAt: string | null;
  revokedAt: string | null;
  rotatedAt: string | null;
  rotationCount: number;
}

/** Everything a visitor learns about the agent behind a link. Deliberately
 *  slim: no config, no resources, no workflow (FR-014). */
export interface IShareResolved {
  agentId: string;
  agentName: string;
  /** AgentStatusTypes as a plain string; 'running' ⇒ chat is live. */
  agentStatus: string;
}

/** Machine-readable codes carried in the error body so the console can tell
 *  the three failure modes apart without parsing messages. */
export const ShareLinkErrorCodes = {
  LinkInvalid: 'SHARE_LINK_INVALID',
  VisitorInvalid: 'SHARE_VISITOR_INVALID',
  NotFound: 'SHARE_LINK_NOT_FOUND',
} as const;

export type ShareLinkErrorCode =
  (typeof ShareLinkErrorCodes)[keyof typeof ShareLinkErrorCodes];
