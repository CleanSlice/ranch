import type { ICallerParty } from '#/user/auth/domain/auth.types';
import { UserRoleTypes } from '#/user/user/domain/user.types';

/** The two lists an account has. An agent is on at most one of them. */
export type AgentAccessListTypes = 'allowed' | 'denied';

export const AGENT_ACCESS_LISTS: readonly AgentAccessListTypes[] = [
  'allowed',
  'denied',
];

export interface IAgentAccessEntry {
  agentId: string;
  list: AgentAccessListTypes;
}

/**
 * One account's access as stored. An account nobody ever edited has no row:
 * it reads as not limited, no entries, `updatedAt` null.
 */
export interface IAgentAccessState {
  userId: string;
  limited: boolean;
  entries: IAgentAccessEntry[];
  updatedAt: Date | null;
}

export type AgentAccessOutcomeKinds = 'all' | 'all_except' | 'only' | 'none';

/** What the lists come to, in the four sentences of the editor. */
export interface IAgentAccessOutcome {
  kind: AgentAccessOutcomeKinds;
  /** Entries behind the sentence that the viewer may see; 0 for all / none. */
  count: number;
}

/** The mark on a row of the user list. */
export interface IAgentAccessSummary {
  kind: AgentAccessOutcomeKinds;
  needsReview: boolean;
}

/** One account's access as one viewer may see it. */
export interface IAgentAccessView {
  userId: string;
  allowed: string[];
  denied: string[];
  outcome: IAgentAccessOutcome;
  needsReview: boolean;
  hasEntriesOutsideView: boolean;
  /** The row's `updatedAt`, ISO; null for an account never edited. */
  version: string | null;
}

/** The whole desired state inside the editor's view. */
export interface IAgentAccessDesired {
  allowed: string[];
  denied: string[];
}

/** A change stated as moves, for the assistant: applied onto the current view. */
export interface IAgentAccessDelta {
  allow?: string[];
  deny?: string[];
  clear?: string[];
}

export interface IAgentAccessChangeOptions {
  /**
   * The `version` the editor read. `undefined` skips the check (a caller
   * that computes its change inside the same transaction); null means
   * "never edited".
   */
  version?: string | null;
  /** Required to turn a limited account into an open one. */
  confirmOpen?: boolean;
  /** Compute and validate, save nothing. */
  dryRun?: boolean;
}

/** What a change did, or would do with `dryRun`. */
export interface IAgentAccessChangeResult {
  view: IAgentAccessView;
  /** False for a dry run and for a change that changed nothing. */
  saved: boolean;
  /** True when the change turns a limited account into an open one. */
  opens: boolean;
}

/** A person, as a token or an acting token proved them. */
export interface IAccessPerson {
  userId: string;
  role: UserRoleTypes;
}

/**
 * Whoever a reach question is asked about. A party (`ICallerParty`), a bare
 * person, or nobody. Only a person whose role is Admin or User is subject to
 * the lists; everybody else reaches every agent.
 */
export type IAccessCaller = ICallerParty | IAccessPerson | null | undefined;

/** Who is changing an account's access. A trusted party acts as the Owner. */
export type IAccessEditor =
  | { kind: 'person'; userId: string; role: UserRoleTypes }
  | { kind: 'trusted' };

/** The person the lists apply to, or null when they do not apply. */
export function accessSubject(caller: IAccessCaller): IAccessPerson | null {
  if (!caller) return null;
  if ('kind' in caller && caller.kind !== 'person') return null;
  const { userId, role } = caller as IAccessPerson;
  if (typeof userId !== 'string' || !userId) return null;
  if (role !== UserRoleTypes.Admin && role !== UserRoleTypes.User) return null;
  return { userId, role };
}

/**
 * The set of agents one caller reaches, as a membership test. Built once per
 * request from one read of the account's lists, then asked about any number
 * of agents: a list is filtered with `filter`, a database query with `where`.
 */
export class AgentReach {
  private readonly allowed: ReadonlySet<string> | null;
  private readonly denied: ReadonlySet<string>;

  constructor(state: Pick<IAgentAccessState, 'limited' | 'entries'> | null) {
    const entries = state?.entries ?? [];
    this.denied = new Set(
      entries.filter((e) => e.list === 'denied').map((e) => e.agentId),
    );
    this.allowed = state?.limited
      ? new Set(
          entries.filter((e) => e.list === 'allowed').map((e) => e.agentId),
        )
      : null;
  }

  /** Everybody the lists do not apply to. */
  static readonly ALL = new AgentReach(null);

  /** True when no agent is hidden from this caller. */
  get unrestricted(): boolean {
    return this.allowed === null && this.denied.size === 0;
  }

  has(agentId: string | null | undefined): boolean {
    if (typeof agentId !== 'string' || !agentId) return this.unrestricted;
    if (this.denied.has(agentId)) return false;
    return this.allowed === null || this.allowed.has(agentId);
  }

  /** The items whose agent is reached, in the order given. */
  filter<T>(items: readonly T[], agentIdOf: (item: T) => string | null): T[] {
    if (this.unrestricted) return [...items];
    return items.filter((item) => {
      const id = agentIdOf(item);
      // A row that names no agent hides no agent.
      return id === null ? true : this.has(id);
    });
  }

  /**
   * The same rule as a Prisma filter on an agent id column, or undefined
   * when nothing is hidden. For lists that are paged in the database.
   */
  where(): { in?: string[]; notIn?: string[] } | undefined {
    if (this.unrestricted) return undefined;
    if (this.allowed !== null) {
      return { in: [...this.allowed].filter((id) => !this.denied.has(id)) };
    }
    return { notIn: [...this.denied] };
  }
}

export const AgentAccessErrorCodes = {
  NotEditable: 'ACCESS_NOT_EDITABLE',
  ListsOverlap: 'ACCESS_LISTS_OVERLAP',
  ExceedsCeiling: 'ACCESS_EXCEEDS_CEILING',
  OpenNeedsConfirm: 'ACCESS_OPEN_NEEDS_CONFIRM',
  Changed: 'ACCESS_CHANGED',
  /** No `code` on the wire: the ordinary "not found". */
  AgentNotFound: 'AGENT_NOT_FOUND',
  UserNotFound: 'USER_NOT_FOUND',
} as const;

export type AgentAccessErrorCodeTypes =
  (typeof AgentAccessErrorCodes)[keyof typeof AgentAccessErrorCodes];

/** Each refusal in a sentence the person can act on (FR-018). */
export const AGENT_ACCESS_REFUSALS = {
  owner:
    'The Owner reaches every agent. There is no agent access to change on ' +
    'the Owner account.',
  self: 'You cannot change your own agent access. Ask the Owner to do it.',
  otherAdmin:
    "An Admin cannot change another Admin's agent access. Ask the Owner " +
    'to do it.',
  notAllowed: 'Your account cannot change agent access. Ask an administrator.',
  overlap:
    'An agent cannot be both allowed and denied. Put each agent on one ' +
    'list only.',
  ceiling: 'This would open agents you do not have. Ask the Owner.',
  confirm:
    'This account will reach every agent that is not denied. Confirm to ' +
    'save it.',
  changed:
    'Someone else changed this access in the meantime. Reload it and try ' +
    'again.',
  agentNotFound: 'Agent not found',
  userNotFound: 'User not found',
} as const;

/**
 * A refused read or change of agent access. The controller turns it into
 * the HTTP answer of contracts/http-api.md, the tool into a tool error with
 * the same sentence.
 */
export class AgentAccessError extends Error {
  constructor(
    readonly code: AgentAccessErrorCodeTypes,
    message: string,
    /** For ACCESS_OPEN_NEEDS_CONFIRM: what the change would come to. */
    readonly outcome?: IAgentAccessOutcome,
  ) {
    super(message);
    this.name = 'AgentAccessError';
  }
}
