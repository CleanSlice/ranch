import type { IAgentAccessEntry, IAgentAccessState } from './agentAccess.types';

/** What one change writes: the whole next state of the account. */
export interface IAgentAccessWrite {
  limited: boolean;
  entries: IAgentAccessEntry[];
  updatedById: string | null;
}

/**
 * One account's access inside a transaction that holds that account's lock:
 * what is read here cannot change before `save` returns.
 */
export interface IAgentAccessTx {
  load(): Promise<IAgentAccessState>;
  /** Every agent that exists, by id. */
  agentIds(): Promise<string[]>;
  save(next: IAgentAccessWrite): Promise<IAgentAccessState>;
}

/**
 * Persistence port of the access lists (CLEAN-231). An abstract class so it
 * is its own injection token, like `IUserGateway`.
 */
export abstract class IAgentAccessGateway {
  /** One query. An account with no row reads as the defaults. */
  abstract load(userId: string): Promise<IAgentAccessState>;

  /** The same for many accounts at once, for the user list. */
  abstract loadMany(userIds: string[]): Promise<Map<string, IAgentAccessState>>;

  /** Every agent that exists, by id. */
  abstract agentIds(): Promise<string[]>;

  /** Whether there is an agent with this id. */
  abstract agentExists(agentId: string): Promise<boolean>;

  /**
   * Run `fn` holding the account's lock, so two edits of one account happen
   * one after the other and the second sees what the first saved.
   */
  abstract transaction<T>(
    userId: string,
    fn: (tx: IAgentAccessTx) => Promise<T>,
  ): Promise<T>;

  /**
   * Inside the transaction that creates an agent (`tx` is that transaction's
   * client): when the creator's account is limited, put the new agent on
   * its allowed list. True when an entry was written.
   */
  abstract allowCreated(
    tx: unknown,
    userId: string,
    agentId: string,
  ): Promise<boolean>;

  /** The account's row and entries, when the account is deleted. */
  abstract removeUser(userId: string): Promise<void>;
}
