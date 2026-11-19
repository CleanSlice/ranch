/**
 * Persistence port of personal pins (CLEAN-231). An abstract class so it is
 * its own injection token, like `IAgentGateway`.
 */
export abstract class IAgentPinGateway {
  /**
   * Pin an agent for one account. Idempotent. False when there is no such
   * agent, so the caller can answer its ordinary "not found".
   */
  abstract pin(userId: string, agentId: string): Promise<boolean>;

  /**
   * Unpin it. Idempotent: an agent that was not pinned is not an error.
   * False when there is no such agent, as for `pin`.
   */
  abstract unpin(userId: string, agentId: string): Promise<boolean>;

  /** The agents this account pinned. One query. */
  abstract pinnedIds(userId: string): Promise<Set<string>>;

  /** The account is being deleted: its pins go with it. */
  abstract removeUser(userId: string): Promise<void>;
}
