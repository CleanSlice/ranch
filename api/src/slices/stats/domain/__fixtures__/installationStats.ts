import type { IAgentGateway } from '#/agent/agent/domain/agent.gateway';
import { AgentPermissionService } from '#/agent/agent/domain/agentPermission.service';
import type { AgentEventService } from '#/agent/event/domain/agentEvent.service';
import type {
  IAgentIncidentData,
  IIncidentRange,
  IIncidentRangeQuery,
} from '#/agent/event/domain/agentEvent.types';
import type { AgentLimitService } from '#/agent/limit/domain';
import type { IChatGateway } from '#/chat/domain/chat.gateway';
import type {
  ChatOutcome,
  IActivityPeriods,
  IAgentFeedbackCounts,
  IAgentOutcomeCounts,
  IInstallationActivity,
} from '#/chat/domain/chat.types';
import type {
  IActivitySummaryOptions,
  IChatActivityGateway,
} from '#/chat/domain/chatActivity.gateway';
import type { ChatInsightService } from '#/chat/domain/chatInsight.service';
import {
  IConversationCountRow,
  agentScopeCondition,
  conversationsFromRows,
} from '#/chat/domain/installationActivity';
import type { IUsageGateway } from '#/usage/domain/usage.gateway';
import type { IUsageData } from '#/usage/domain/usage.types';
import type { AgentAccessService } from '#/user/agentAccess/domain/agentAccess.service';
import { openAccess } from '#/user/agentAccess/domain/__fixtures__/agentAccess';
import type { IStatFigureData } from '../figure.types';
import { FigureRegistry } from '../figureRegistry';
import { activityFigure, refusalsFigure, spendFigure } from '../figures';
import { InstallationStatsService } from '../installationStats.service';
import type { IStatFigureGateway } from '../statFigure.gateway';

/**
 * For specs only: everything `GET /stats/installation` reads, in memory
 * (CLEAN-265).
 *
 * Each stand-in answers the one read the real slice answers, with the
 * conditions the real query carries, and none is more forgiving than the
 * database:
 *
 *  - the activity read counts what the two SQL statements count: hours a
 *    person wrote in, inside the range, never the `internal` channel or a
 *    `peer:` identity, only the agents of the scope, a conversation once
 *    and a person once;
 *  - asked for the outcomes too, it looks at the summary of each of those
 *    conversations and answers two numbers more per agent; not asked, it
 *    looks at none. The question a summary quotes is in this world and
 *    never in what the read answers, as the statement selects no such
 *    column;
 *  - an incident whose agent is gone has no agent id, and a NULL is neither
 *    in a list nor outside one: any scope hides it;
 *  - a read that is given no scope returns every agent, as the query would;
 *  - who manages the assistant is asked of the real `AgentPermissionService`
 *    over these agents, so the rule that takes its conversations out is the
 *    one chat history has (CLEAN-236), not a copy of it.
 *
 * So a service that forgot to pass the scope, or passed the wrong range,
 * gets other agents' rows back and its spec fails.
 */

type Scope = { in?: string[]; notIn?: string[] } | undefined;

const inScope = (agentId: string, scope: Scope) =>
  (scope?.in === undefined || scope.in.includes(agentId)) &&
  (scope?.notIn === undefined || !scope.notIn.includes(agentId));

const within = (at: Date, from: Date, to: Date) =>
  at.getTime() >= from.getTime() && at.getTime() <= to.getTime();

const DAY_MS = 24 * 60 * 60 * 1000;

const utcDay = (day: string) => new Date(`${day}T00:00:00.000Z`);

export interface IFleetAgent {
  id: string;
  name: string;
  /** True for the Ranch admin agent, the one only the Owner manages. */
  admin?: boolean;
}

/** A `ChatActivityHour` row, with the conversation's own columns. */
export interface IFleetHour {
  sessionId: string;
  agentId: string;
  externalUserId: string;
  /** `bridle` unless said. */
  channel?: string;
  /** Start of the hour, ISO. */
  hour: string;
  userMessages: number;
  agentMessages: number;
}

export interface IFleetRating {
  /** The conversation's agent: a rating has none of its own. */
  agentId: string;
  rating: 1 | -1;
  at: string;
}

/** What a conversation's row says of its summary (CLEAN-270). */
export interface IFleetSummary {
  /** Null: a summary an older release wrote, with no outcome stored. */
  outcome: ChatOutcome | null;
  /** The person's main question: theirs, and no part of this view. */
  question?: string | null;
}

export interface IFleetUsage {
  agentId: string;
  /** The name stored with the row; null when no report could read it. */
  agentName?: string | null;
  /** The UTC day, `YYYY-MM-DD`. */
  day: string;
  model: string;
  input: number;
  output: number;
  calls: number;
}

export interface IFleetLoadDay {
  agentId: string;
  /** The UTC day, `YYYY-MM-DD`. */
  day: string;
  refused: number;
  accepted?: number;
}

export interface IFleetIncident {
  number: number;
  /** Null: the agent was deleted since. */
  agentId: string | null;
  agentName: string;
  reason: string | null;
  openedAt: string;
  /** Null: still open. */
  closedAt: string | null;
}

export interface IFleetWorld {
  agents: IFleetAgent[];
  hours: IFleetHour[];
  /** Whether the installation produces summaries. False unless said. */
  summaries: boolean;
  /** By conversation id; a conversation not named here has no summary. */
  summarised: Record<string, IFleetSummary>;
  ratings: IFleetRating[];
  usage: IFleetUsage[];
  loadDays: IFleetLoadDay[];
  incidents: IFleetIncident[];
  /** `StatFigure` rows, key to ISO date: `activity` and `refusals`. */
  completeSince: Record<string, string>;
}

const EMPTY: IFleetWorld = {
  agents: [],
  hours: [],
  summaries: false,
  summarised: {},
  ratings: [],
  usage: [],
  loadDays: [],
  incidents: [],
  completeSince: {},
};

/**
 * A read that remembers what it was asked, so a spec can check the range
 * and the scope a query went out with. Not `jest.fn`: this file is compiled
 * with the application, where jest does not exist.
 */
function recorded<A extends unknown[], R>(read: (...args: A) => R) {
  const calls: A[] = [];
  const wrapped = (...args: A): R => {
    calls.push(args);
    return read(...args);
  };
  return Object.assign(wrapped, { calls });
}

export function installationHarness(
  seed: Partial<IFleetWorld> = {},
  access: AgentAccessService = openAccess(),
  /** "Today" for the read that counts back from it (`findRecentAll`). */
  clock: () => Date = () => new Date(),
) {
  const world: IFleetWorld = { ...EMPTY, ...seed };

  /** The hours the two statements read: a person's, of the scope's agents. */
  const counted = (from: Date, to: Date, agentScope: Scope) =>
    world.hours.filter(
      (h) =>
        within(new Date(h.hour), from, to) &&
        h.userMessages > 0 &&
        (h.channel ?? 'bridle') !== 'internal' &&
        !h.externalUserId.startsWith('peer:') &&
        inScope(h.agentId, agentScope),
    );

  const activity = {
    summaryForAgents: recorded(
      (
        periods: IActivityPeriods,
        agentScope?: Scope,
        options: IActivitySummaryOptions = {},
      ): Promise<IInstallationActivity> => {
        if (!agentScopeCondition(agentScope).matchesAny) {
          return Promise.resolve({
            conversations: [],
            outcomes: [],
            people: { value: 0, previous: 0 },
          });
        }
        // One row per conversation, then counted by agent, stored channel
        // and share: the rows the first statement answers.
        const sessions = new Map<string, IFleetHour>();
        for (const h of counted(periods.from, periods.to, agentScope)) {
          sessions.set(h.sessionId, h);
        }
        const groups = new Map<string, IConversationCountRow>();
        for (const h of sessions.values()) {
          const channel = h.channel ?? 'bridle';
          const share = h.externalUserId.startsWith('share-');
          const key = `${h.agentId}|${channel}|${share}`;
          const group = groups.get(key) ?? {
            agentId: h.agentId,
            channel,
            share,
            conversations: 0n,
          };
          group.conversations = BigInt(group.conversations) + 1n;
          groups.set(key, group);
        }
        // The second statement: one row per identity over both periods,
        // flagged by where its hours fall.
        const beforePeriod = new Date(periods.from.getTime() - 1);
        const identities = (from: Date, to: Date) =>
          new Set(counted(from, to, agentScope).map((h) => h.externalUserId))
            .size;
        // The same statement with each conversation joined to its summary,
        // when the outcomes were asked for: two numbers per agent leave
        // it, and no conversation or anything a summary quotes does.
        const ended = new Map<string, IAgentOutcomeCounts>();
        if (options.outcomes) {
          for (const h of sessions.values()) {
            const summary = world.summarised[h.sessionId];
            if (!summary) continue;
            const counts = ended.get(h.agentId) ?? {
              agentId: h.agentId,
              summarised: 0,
              open: 0,
            };
            counts.summarised += 1;
            if (summary.outcome === 'open') counts.open += 1;
            ended.set(h.agentId, counts);
          }
        }
        return Promise.resolve({
          conversations: conversationsFromRows([...groups.values()]),
          outcomes: [...ended.values()].sort((a, b) =>
            a.agentId.localeCompare(b.agentId),
          ),
          people: {
            value: identities(periods.from, periods.to),
            previous: identities(periods.previousFrom, beforePeriod),
          },
        });
      },
    ),
  };

  const insight = {
    isEnabled: recorded(() => Promise.resolve(world.summaries)),
  };

  const chats = {
    feedbackByAgent: recorded(
      (
        from: Date,
        to: Date,
        agentScope?: Scope,
      ): Promise<IAgentFeedbackCounts[]> => {
        const byAgent = new Map<string, IAgentFeedbackCounts>();
        for (const r of world.ratings) {
          if (!within(new Date(r.at), from, to)) continue;
          if (!inScope(r.agentId, agentScope)) continue;
          const counts = byAgent.get(r.agentId) ?? {
            agentId: r.agentId,
            rated: 0,
            down: 0,
          };
          counts.rated += 1;
          if (r.rating < 0) counts.down += 1;
          byAgent.set(r.agentId, counts);
        }
        return Promise.resolve(
          [...byAgent.values()].sort((a, b) =>
            a.agentId.localeCompare(b.agentId),
          ),
        );
      },
    ),
  };

  const usageRow = (u: IFleetUsage): IUsageData => ({
    id: `${u.agentId}|${u.model}|${u.day}`,
    agentId: u.agentId,
    agentName: u.agentName ?? null,
    llmCredentialId: null,
    model: u.model,
    date: utcDay(u.day),
    inputTokens: u.input,
    outputTokens: u.output,
    callCount: u.calls,
    createdAt: utcDay(u.day),
    updatedAt: utcDay(u.day),
  });
  /** As the gateway orders every read: newest day first, then by model. */
  const ordered = (rows: IUsageData[]) =>
    rows.sort(
      (a, b) =>
        b.date.getTime() - a.date.getTime() || a.model.localeCompare(b.model),
    );

  const usage = {
    findRange: recorded((from: Date, to: Date, agentIds?: readonly string[]) =>
      Promise.resolve(
        ordered(
          world.usage
            .filter((u) => {
              const date = utcDay(u.day).getTime();
              return (
                date >= from.getTime() &&
                date < to.getTime() &&
                (agentIds === undefined || agentIds.includes(u.agentId))
              );
            })
            .map(usageRow),
        ),
      ),
    ),
    // What the admin overview reads (`UsageGateway.findRecentAll`): from the
    // start of the UTC day `days` days ago, with no upper end.
    findRecentAll: recorded((days: number) => {
      const today = Math.floor(clock().getTime() / DAY_MS) * DAY_MS;
      const since = today - days * DAY_MS;
      return Promise.resolve(
        ordered(
          world.usage
            .filter((u) => utcDay(u.day).getTime() >= since)
            .map(usageRow),
        ),
      );
    }),
  };

  const limits = {
    loadDays: recorded((agentIds: string[], from: Date, to: Date) =>
      Promise.resolve(
        world.loadDays
          .filter((d) => {
            const day = utcDay(d.day).getTime();
            return (
              agentIds.includes(d.agentId) &&
              day >= from.getTime() &&
              day < to.getTime()
            );
          })
          .map((d) => ({
            agentId: d.agentId,
            day: utcDay(d.day),
            accepted: d.accepted ?? 0,
            refused: d.refused,
            exempt: 0,
          })),
      ),
    ),
    firstLoadDayAt: () => Promise.resolve(null),
  };

  const events = {
    incidentsInRange: recorded(
      (query: IIncidentRangeQuery): Promise<IIncidentRange> => {
        const scope = query.agentScope;
        const matching = world.incidents
          .filter((i) => {
            const openedAt = new Date(i.openedAt).getTime();
            return (
              openedAt <= query.to.getTime() &&
              (openedAt >= query.from.getTime() || i.closedAt === null)
            );
          })
          .filter(
            (i) => !scope || (i.agentId !== null && inScope(i.agentId, scope)),
          )
          .sort(
            (a, b) =>
              new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime() ||
              b.number - a.number,
          );
        return Promise.resolve({
          items: matching.slice(0, query.limit).map(
            (i) =>
              ({
                id: `incident-${i.number}`,
                number: i.number,
                agentId: i.agentId,
                agentName: i.agentName,
                open: i.closedAt === null,
                reason: i.reason,
                openedAt: new Date(i.openedAt),
                closedAt: i.closedAt === null ? null : new Date(i.closedAt),
                // What an incident also holds, and what this view leaves
                // where it is.
                witnesses: ['cluster-watcher'],
                slackChannel: 'C-ops-secret',
              }) as unknown as IAgentIncidentData,
          ),
          total: matching.length,
        });
      },
    ),
  };

  const agents = {
    findAll: recorded(() =>
      Promise.resolve(
        world.agents.map((a) => ({
          id: a.id,
          name: a.name,
          // What an agent also holds, and what no answer may carry.
          config: { note: `config-of-${a.name}` },
          llmCredentialId: `llm-of-${a.id}`,
        })),
      ),
    ),
    findById: recorded((id: string) => {
      const agent = world.agents.find((a) => a.id === id);
      return Promise.resolve(agent ? { id, name: agent.name } : null);
    }),
    findAdmin: recorded(() => {
      const ranch = world.agents.find((a) => a.admin === true);
      return Promise.resolve(
        ranch ? { id: ranch.id, name: ranch.name, isAdmin: true } : null,
      );
    }),
  };

  const figureRows: IStatFigureData[] = Object.entries(world.completeSince).map(
    ([key, since]) => ({
      key,
      completeSince: new Date(since),
      updatedAt: new Date(since),
    }),
  );
  const registry = new FigureRegistry({
    findAll: () => Promise.resolve(figureRows),
    createIfAbsent: () => Promise.resolve(),
    remove: () => Promise.resolve(),
  } as IStatFigureGateway);
  registry.register(activityFigure);
  registry.register(refusalsFigure(limits as unknown as AgentLimitService));
  registry.register(spendFigure);

  const service = new InstallationStatsService(
    activity as unknown as IChatActivityGateway,
    chats as unknown as IChatGateway,
    insight as unknown as ChatInsightService,
    usage as unknown as IUsageGateway,
    agents as unknown as IAgentGateway,
    limits as unknown as AgentLimitService,
    events as unknown as AgentEventService,
    access,
    new AgentPermissionService(agents as unknown as IAgentGateway, access),
    registry,
  );

  return {
    service,
    world,
    reads: { activity, chats, insight, usage, limits, events, agents },
  };
}
