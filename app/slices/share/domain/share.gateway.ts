import type { IShareLinkState, IShareResolved } from './share.types';

/**
 * A 200 whose body could not be read as a resolved agent.
 *
 * Deliberately not the same outcome as a 404: an unreadable answer proves
 * nothing about the link, so it has to reach the store as a *failure*
 * (`unavailable` — keep the conversation, retry) rather than as `null`, which
 * the page treats as the terminal "this link is invalid or no longer active".
 */
export class ShareResolveUnreadableError extends Error {
  constructor() {
    super('The share-link response could not be read');
    this.name = 'ShareResolveUnreadableError';
  }
}

/**
 * Contract for the share-link API. Implemented by `ShareGateway` in the data
 * layer; the service and store depend only on this abstraction.
 *
 * The first four methods are owner-side (`/agents/:agentId/share-link`, behind
 * the JWT guard) and all answer with the agent's current link state, so the
 * caller never has to re-read after acting. `resolve` is the one public,
 * unauthenticated call the visitor page makes.
 */
export abstract class IShareGateway {
  abstract getLink(agentId: string): Promise<IShareLinkState>;
  /** Idempotent: returns the existing active link, or mints one. */
  abstract share(agentId: string): Promise<IShareLinkState>;
  abstract regenerate(agentId: string): Promise<IShareLinkState>;
  abstract revoke(agentId: string): Promise<IShareLinkState>;
  /**
   * Look up the agent behind a token. `null` means — and only means — that the
   * API answered 404: unknown, revoked and regenerated tokens all get that
   * same answer so a visitor cannot tell them apart (FR-013).
   *
   * Everything else rejects: a transport failure with the axios error, an
   * unreadable 200 body with `ShareResolveUnreadableError`. Neither says the
   * link is dead, and the store must not render them as if it were.
   */
  abstract resolve(token: string): Promise<IShareResolved | null>;
}
