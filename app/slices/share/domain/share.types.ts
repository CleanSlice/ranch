// Domain types for the share slice. Envelope-free; the data layer maps the
// API's `ShareLinkDto` / `ShareResolvedDto` payloads onto these.
//
// Mirrors specs/010-share-agent-link/data-model.md, "Owner-side view model".

/**
 * What the owner sees for one agent: is the agent shared, and with which link.
 *
 * `token` is only ever set while `active` — a revoked link keeps no secret.
 * `url` is built client-side (`${window.location.origin}/share?token=…`) by the
 * store: the API deliberately never learns the console's origin, so the data
 * layer leaves this `null` and only the store fills it in.
 */
export interface IShareLinkState {
  active: boolean;
  token: string | null;
  url: string | null;
  createdAt: string | null;
  revokedAt: string | null;
  rotatedAt: string | null;
}

/** Accepted attachment types, as the families the info panel names. */
export const SHARE_ATTACHMENT_KINDS = [
  'image',
  'pdf',
  'document',
  'spreadsheet',
  'presentation',
  'text',
] as const;
export type ShareAttachmentKind = (typeof SHARE_ATTACHMENT_KINDS)[number];

/** A skill of the agent's template: what it is called and what it is for. */
export interface IShareSkill {
  title: string;
  description: string | null;
}

/**
 * The agent's configured request limits. Values only: the allowance is one
 * per agent and shared by every visitor, so the API never says how much of it
 * is spent, and the page must always say that it is shared.
 */
export interface IShareLimits {
  perMinute: number | null;
  perHour: number | null;
  perDay: number | null;
}

export interface IShareAttachments {
  maxPerMessage: number;
  maxFileBytes: number;
  maxMessageBytes: number;
  kinds: ShareAttachmentKind[];
}

/**
 * Everything a visitor is allowed to know about the agent behind a link.
 *
 * Name and status run the page: the name titles it, the status decides
 * between a live composer and the "agent unavailable" state (FR-015). The
 * rest is the summary the info panel shows (CLEAN-237) — an allowlist the API
 * builds field by field. Nothing else from the agent is exposed (FR-014).
 */
export interface IShareResolved {
  agentId: string;
  agentName: string;
  /** `AgentStatusTypes` as a plain string; `'running'` ⇒ chat is live. */
  agentStatus: string;
  /** The agent's own description, else its template's, else `null`. */
  description: string | null;
  skills: IShareSkill[];
  /** `null` ⇒ the agent has no request limits. */
  limits: IShareLimits | null;
  /** `null` when the API did not say — an older API, or an unreadable block. */
  attachments: IShareAttachments | null;
}

/**
 * What one `resolve()` established about a token. Three outcomes, not two,
 * because the visitor page must not treat a dropped connection the way it
 * treats a dead link:
 *
 * - `resolved`    — the API answered; the agent is in the store's `resolved`.
 * - `invalid`     — the API answered 404: unknown, revoked or regenerated
 *                   token (all identical on purpose, FR-013). Terminal — that
 *                   token never comes back to life.
 * - `unavailable` — nothing was learned (offline, 5xx, timeout). The last good
 *                   `resolved` is kept, so a visitor mid-conversation does not
 *                   lose the chat over one failed background poll.
 */
export type ShareResolveOutcome = 'resolved' | 'invalid' | 'unavailable';

/**
 * The credentials a visitor's chat request carries: the link secret plus the
 * per-browser visitor id (`useShareVisitorId`). Travels on the bridle
 * conversation descriptor and becomes the `X-Share-Token` / `X-Share-Visitor`
 * header pair — per request, never on the shared API client config.
 */
export interface IShareContext {
  token: string;
  visitorId: string;
}
