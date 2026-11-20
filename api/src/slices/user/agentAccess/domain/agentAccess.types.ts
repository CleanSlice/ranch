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
  /**
   * Set when there is no such account at all. A token outlives the account
   * it was issued to (the bearer guard does not read the user row), and an
   * account that is gone has no row here either, which would otherwise read
   * as the defaults: every agent. An account that does not exist reaches
   * nothing.
   */
  accountMissing?: true;
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
/**
 * The assistant as one person has it (CLEAN-240): its agent id and whether
 * it is switched on for them. Not an entry in any list.
 */
export interface IAssistantSwitch {
  id: string;
  enabled: boolean;
}

/**
 * Where the reach learns about the assistant. Provided by the assistant's
 * own slice and handed to `AgentAccessService` at start, so that this slice
 * knows the question and nothing about the settings behind the answer.
 */
export interface IAssistantAvailability {
  /** The agent that is the assistant, or null while there is none. */
  assistantId(): Promise<string | null>;
  /** The switch for one person; null while there is no assistant. */
  forPerson(person: IAccessPerson): Promise<IAssistantSwitch | null>;
}

export class AgentReach {
  private readonly allowed: ReadonlySet<string> | null;
  private readonly denied: ReadonlySet<string>;
  /**
   * The assistant, when the installation has one. Asked before the lists:
   * limiting an account to some agents must not take the assistant away,
   * and switching it off must hold whatever the lists say.
   */
  private readonly assistant: IAssistantSwitch | null;

  constructor(
    state: Pick<
      IAgentAccessState,
      'limited' | 'entries' | 'accountMissing'
    > | null,
    assistant: IAssistantSwitch | null = null,
  ) {
    if (state?.accountMissing === true) {
      this.denied = new Set();
      this.allowed = new Set();
      // An account that is gone has nothing, the assistant included.
      this.assistant = assistant ? { id: assistant.id, enabled: false } : null;
      return;
    }
    this.assistant = assistant;
    const entries = (state?.entries ?? []).filter(
      (e) => e.agentId !== assistant?.id,
    );
    this.denied = new Set(
      entries.filter((e) => e.list === 'denied').map((e) => e.agentId),
    );
    this.allowed = state?.limited
      ? new Set(
          entries.filter((e) => e.list === 'allowed').map((e) => e.agentId),
        )
      : null;
  }

  static readonly ALL = new AgentReach(null);

  /**
   * This reach with some agents taken out of it, whatever the lists say. For
   * a question that is narrower than "may they use the agent": the
   * conversations of an agent only the Owner manages are not an Admin's to
   * read because they may talk to it (CLEAN-236).
   */
  without(agentIds: readonly string[]): AgentReach {
    if (agentIds.length === 0) return this;
    const entry =
      (list: IAgentAccessEntry['list']) =>
      (agentId: string): IAgentAccessEntry => ({ agentId, list });
    // The assistant is asked before the lists (CLEAN-240), so taking it out
    // has to be said to its switch: a denied entry alone would not hide it.
    const assistant = this.assistant
      ? {
          id: this.assistant.id,
          enabled:
            this.assistant.enabled && !agentIds.includes(this.assistant.id),
        }
      : null;
    return new AgentReach(
      {
        limited: this.allowed !== null,
        entries: [
          ...[...this.denied, ...agentIds].map(entry('denied')),
          ...[...(this.allowed ?? [])].map(entry('allowed')),
        ],
      },
      assistant,
    );
  }

  /** True when no agent is hidden from this caller. */
  get unrestricted(): boolean {
    return (
      this.allowed === null &&
      this.denied.size === 0 &&
      this.assistant?.enabled !== false
    );
  }

  has(agentId: string | null | undefined): boolean {
    if (typeof agentId !== 'string' || !agentId) return this.unrestricted;
    if (this.assistant && agentId === this.assistant.id) {
      return this.assistant.enabled;
    }
    if (this.denied.has(agentId)) return false;
    return this.allowed === null || this.allowed.has(agentId);
  }

  filter<T>(items: readonly T[], agentIdOf: (item: T) => string | null): T[] {
    if (this.unrestricted) return [...items];
    return items.filter((item) => {
      const id = agentIdOf(item);
      return id === null ? true : this.has(id);
    });
  }

  where(): { in?: string[]; notIn?: string[] } | undefined {
    if (this.unrestricted) return undefined;
    if (this.allowed !== null) {
      const ids = [...this.allowed].filter((id) => !this.denied.has(id));
      if (this.assistant?.enabled) ids.push(this.assistant.id);
      return { in: ids };
    }
    const hidden = [...this.denied];
    if (this.assistant && !this.assistant.enabled) {
      hidden.push(this.assistant.id);
    }
    return { notIn: hidden };
  }
}

export const AgentAccessErrorCodes = {
  NotEditable: 'ACCESS_NOT_EDITABLE',
  ListsOverlap: 'ACCESS_LISTS_OVERLAP',
  ExceedsCeiling: 'ACCESS_EXCEEDS_CEILING',
  OpenNeedsConfirm: 'ACCESS_OPEN_NEEDS_CONFIRM',
  Changed: 'ACCESS_CHANGED',
  /** The assistant is not set through the lists (CLEAN-240). */
  AssistantNotListed: 'ASSISTANT_NOT_LISTED',
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
  assistant:
    'The assistant is not on these lists. Who can use it is its own ' +
    'setting, on the account and on the assistant’s page.',
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
