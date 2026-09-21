import type { IShareLinkState } from './share.types';

/**
 * Contract for the owner side of the share-link API
 * (`/agents/:agentId/share-link`). Implemented by `ShareGateway`.
 *
 * Every method answers with the agent's current link state, so the caller
 * never has to re-read after acting.
 */
export abstract class IShareGateway {
  abstract getLink(agentId: string): Promise<IShareLinkState>;
  /** Idempotent: returns the existing active link, or mints one. */
  abstract share(agentId: string): Promise<IShareLinkState>;
  abstract regenerate(agentId: string): Promise<IShareLinkState>;
  abstract revoke(agentId: string): Promise<IShareLinkState>;
}
