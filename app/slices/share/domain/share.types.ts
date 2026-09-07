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

/**
 * Everything a visitor is allowed to know about the agent behind a link.
 *
 * Deliberately three fields: name to title the page, status to decide between
 * a live composer and the "agent unavailable" state (FR-015). Nothing else
 * from the agent is exposed (FR-014).
 */
export interface IShareResolved {
  agentId: string;
  agentName: string;
  /** `AgentStatusTypes` as a plain string; `'running'` ⇒ chat is live. */
  agentStatus: string;
}

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
