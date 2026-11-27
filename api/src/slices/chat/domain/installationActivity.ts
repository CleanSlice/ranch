import {
  ActivityChannel,
  ActivityChannelTypes,
  ChatChannelTypes,
  IAgentChannelConversations,
  IAgentOutcomeCounts,
  IChatAgentScope,
  IInstallationActivity,
} from './chat.types';

// The parts of the installation's activity read that are not SQL (CLEAN-265;
// spec 038, contracts/collection.md section 6). The query itself counts
// distinct conversations and people in the database and cannot run in a
// spec. What it is told (which agents) and what is made of its answer (which
// channel a row is, a bigint as a number) are decided here, where a spec
// can hold them.

/**
 * A caller's reach as the conditions a query needs: which agents to keep,
 * which to leave out, or that there is nothing to ask.
 */
export interface IAgentScopeCondition {
  /**
   * False when the scope admits no agent at all. The read then answers
   * empty without a query: `IN ()` is not SQL, and leaving the condition
   * out would answer for every agent.
   */
  matchesAny: boolean;
  /** `"agentId" IN (…)`, never empty; null for no such condition. */
  in: string[] | null;
  /** `"agentId" NOT IN (…)`, never empty; null for no such condition. */
  notIn: string[] | null;
}

/**
 * The scope the other chat reads hand to Prisma as `agentId: scope`
 * (`buildWhere` in `data/chat.gateway.ts`), read the way Prisma reads it:
 *
 *  - no scope, or neither list: every agent;
 *  - `in`: those agents only, and an empty `in` is no agent;
 *  - `notIn`: every agent but those, and an empty `notIn` is every agent;
 *  - both: both conditions.
 *
 * `AgentReach.where()` answers the first three: nothing for a caller with no
 * hidden agent, `in` for one limited to a list, `notIn` for one who is not
 * limited and has some denied.
 */
export function agentScopeCondition(
  scope: IChatAgentScope | undefined,
): IAgentScopeCondition {
  const allowed = scope?.in === undefined ? null : [...new Set(scope.in)];
  const denied = scope?.notIn === undefined ? null : [...new Set(scope.notIn)];
  if (allowed !== null && allowed.length === 0) {
    return { matchesAny: false, in: null, notIn: null };
  }
  return {
    matchesAny: true,
    in: allowed,
    notIn: denied !== null && denied.length > 0 ? denied : null,
  };
}

/**
 * The channel a conversation is counted under. `share` says whether its
 * identity is a share link's visitor; that only means something on the
 * console chat, which is the one a link opens.
 */
export function activityChannelOf(
  channel: string,
  share: boolean,
): ActivityChannel {
  if (channel === ChatChannelTypes.Bridle) {
    return share ? ActivityChannelTypes.Share : ActivityChannelTypes.Console;
  }
  if (channel === ChatChannelTypes.Telegram) {
    return ActivityChannelTypes.Telegram;
  }
  if (channel === ChatChannelTypes.Slack) return ActivityChannelTypes.Slack;
  return ActivityChannelTypes.Other;
}

/** A row of the conversations query: one agent, one stored channel. */
export interface IConversationCountRow {
  agentId: string;
  channel: string;
  /** Whether the identities of this row are share visitors. */
  share: boolean;
  /** `COUNT(*)`: a bigint from Postgres. */
  conversations: bigint | number;
  /**
   * How many of them have a summary, and how many of those were left open
   * (CLEAN-270). Present only when the statement was asked for the
   * outcomes: where summaries are off it has no such columns.
   */
  summarised?: bigint | number;
  open?: bigint | number;
}

/** The row of the people query. */
export interface IPeopleCountRow {
  value: bigint | number | null;
  previous: bigint | number | null;
}

/**
 * The rows by agent and channel as the view names channels. A conversation
 * has one agent, one channel and one identity for good, so it is in exactly
 * one row, and rows that fall into one bucket (`other`) are added.
 */
export function conversationsFromRows(
  rows: readonly IConversationCountRow[],
): IAgentChannelConversations[] {
  const byKey = new Map<string, IAgentChannelConversations>();
  for (const row of rows) {
    const channel = activityChannelOf(row.channel, row.share);
    const key = `${row.agentId}|${channel}`;
    const entry = byKey.get(key) ?? {
      agentId: row.agentId,
      channel,
      conversations: 0,
    };
    entry.conversations += Number(row.conversations);
    byKey.set(key, entry);
  }
  return [...byKey.values()].sort(
    (a, b) =>
      a.agentId.localeCompare(b.agentId) || a.channel.localeCompare(b.channel),
  );
}

/**
 * How each agent's conversations ended, from the same rows: the agent's
 * channels added together. An agent none of whose conversations has a
 * summary is absent, and so is every agent when the rows carry no outcome.
 * By agent id, so that the same rows give the same order.
 */
export function outcomesFromRows(
  rows: readonly IConversationCountRow[],
): IAgentOutcomeCounts[] {
  const byAgent = new Map<string, IAgentOutcomeCounts>();
  for (const row of rows) {
    const entry = byAgent.get(row.agentId) ?? {
      agentId: row.agentId,
      summarised: 0,
      open: 0,
    };
    entry.summarised += Number(row.summarised ?? 0);
    entry.open += Number(row.open ?? 0);
    byAgent.set(row.agentId, entry);
  }
  return [...byAgent.values()]
    .filter((entry) => entry.summarised > 0)
    .sort((a, b) => a.agentId.localeCompare(b.agentId));
}

export function peopleFromRows(
  rows: readonly IPeopleCountRow[],
): IInstallationActivity['people'] {
  const [row] = rows;
  return {
    value: Number(row?.value ?? 0),
    previous: Number(row?.previous ?? 0),
  };
}
