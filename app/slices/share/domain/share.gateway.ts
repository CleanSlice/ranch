import type { IShareLinkState, IShareResolved } from './share.types';

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
   * Look up the agent behind a token. Rejects (404) for unknown *and* revoked
   * tokens with an identical body, so a visitor cannot tell them apart
   * (FR-013); `null` means the API answered with something unusable.
   */
  abstract resolve(token: string): Promise<IShareResolved | null>;
}
