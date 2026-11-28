import { Injectable } from '@nestjs/common';
import { IAgentGateway } from '#/agent/agent/domain/agent.gateway';
import { AgentPermissionService } from '#/agent/agent/domain/agentPermission.service';
import { AgentEventService } from '#/agent/event/domain/agentEvent.service';
import {
  EVENT_PAGE_DEFAULT,
  IAgentIncidentData,
} from '#/agent/event/domain/agentEvent.types';
import { AgentLimitService } from '#/agent/limit/domain';
import { IChatGateway } from '#/chat/domain/chat.gateway';
import {
  ActivityChannel,
  IAgentChannelConversations,
  IAgentFeedbackCounts,
  IAgentOutcomeCounts,
} from '#/chat/domain/chat.types';
import { IChatActivityGateway } from '#/chat/domain/chatActivity.gateway';
import { ChatInsightService } from '#/chat/domain/chatInsight.service';
import { hasPrice } from '#/usage/domain/model-pricing';
import { IUsageGateway } from '#/usage/domain/usage.gateway';
import { IUsageData } from '#/usage/domain/usage.types';
import { IUsageRollup, rollUpAcrossAgents } from '#/usage/domain/usage-rollup';
import { AgentAccessService } from '#/user/agentAccess/domain/agentAccess.service';
import { ICallerParty } from '#/user/auth/domain/auth.types';
import { FigureRegistry } from './figureRegistry';
import {
  IInstallationAgent,
  IInstallationChannel,
  IInstallationDay,
  IInstallationIncident,
  IInstallationModel,
  IInstallationQuality,
  IInstallationQuestion,
  IInstallationRefusals,
  IInstallationStats,
  INSTALLATION_NOTED_FIGURES,
} from './installationStats.types';
import {
  UTC_ZONE,
  installationRange,
  localDay,
  shiftDay,
  startOfDay,
} from './period';

/**
 * How many incidents a view lists: the page the console's own incident list
 * opens with (`EVENT_PAGE_DEFAULT`). The block is a glance at what went
 * wrong in the period, newest first; a period with more than this is an
 * installation in trouble, and whoever looks then reads the incident list,
 * which pages. `incidentsTotal` says how many there are, so the cut never
 * reads as "that was all".
 */
export const INCIDENTS_SHOWN = EVENT_PAGE_DEFAULT;

/** The days a projection is made for (spec 038, FR-016). */
const PROJECTION_DAYS = 30;

type Named = { id: string; name: string };

/**
 * The installation's statistics, through the agents the caller reaches
 * (CLEAN-265; spec 038, contracts/api.md `GET /stats/installation`), behind
 * the route and the tool `get_installation_stats` alike.
 *
 * It owns no fact. Every number is read through the slice that keeps it
 * (docs/statistics.md): people, conversations and channels from `chat`'s
 * hours, counted in the database; how those conversations ended from their
 * summaries, counted there too (CLEAN-270); ratings from `chat`; tokens,
 * calls and
 * cost from `usage`, rolled up and priced by the functions the admin
 * overview uses, so the two cannot disagree about a day; refusals from
 * `agent/limit`; incidents from `agent/event`; names from the agent gateway.
 *
 * One thing bounds every read: the agents the caller reaches now. An agent
 * outside the reach is in no list and in no total (FR-021). Days are UTC
 * days for everybody, the boundary spend and refusals are kept on (FR-029).
 *
 * The figures built from conversations are bound once more. What people
 * said to an agent only the Owner manages, the Ranch assistant, is the
 * Owner's (CLEAN-236), and every chat tool says the same since CLEAN-263
 * and CLEAN-267. So people, the quality rows (their open share included:
 * an outcome is a reading of a conversation) and the channels are counted
 * over the reach less those agents, the scope chat history reads with, and
 * `reach.ownerOnly` names what was taken out: whoever leaves an agent out
 * owes the caller the reason.
 *
 * So are the records Ranch keeps about that agent (CLEAN-268): tokens,
 * calls, cost, the days, the agents by cost, the projection and the
 * requests refused by its limits are read over the same narrower reach.
 * What the assistant spent is how much everybody leaned on it, and it stays
 * in the installation's totals for the Owner alone. The admin usage
 * overview leaves it out by the same rule since that change, so the two
 * still give the same numbers (FR-037). Incidents keep the plain reach:
 * that the assistant was down, and when, is what anybody who has it may
 * know, as `list_agent_incidents` answers.
 *
 * Nothing that names a person leaves here: people are counted in the query
 * and arrive as two numbers.
 */
@Injectable()
export class InstallationStatsService {
  constructor(
    private readonly activity: IChatActivityGateway,
    private readonly chats: IChatGateway,
    private readonly insight: ChatInsightService,
    private readonly usage: IUsageGateway,
    private readonly agents: IAgentGateway,
    private readonly limits: AgentLimitService,
    private readonly events: AgentEventService,
    private readonly access: AgentAccessService,
    private readonly permission: AgentPermissionService,
    private readonly registry: FigureRegistry,
  ) {}

  async forCaller(
    // A party, not any caller the access lists take: who manages an agent
    // is asked about a party, and both the route and the tool have one.
    caller: ICallerParty,
    question: IInstallationQuestion,
    now: Date = new Date(),
  ): Promise<IInstallationStats> {
    const range = installationRange(question.period, now);
    // Spend and refusals are day rows, kept at the UTC midnight their day
    // starts on: today's row is inside the period, so the read runs to the
    // end of today, not to this moment.
    const today = localDay(now, UTC_ZONE);
    const endOfToday = startOfDay(shiftDay(today, 1), UTC_ZONE);

    const [reach, ownerOnly, everyAgent, summariesOn] = await Promise.all([
      this.access.reachableIds(caller),
      this.permission.ownerOnlyIds(caller),
      this.agents.findAll(),
      // Whether this installation produces summaries (CLEAN-270). Asked
      // before anything of them is read: when it does not, the ordinary
      // case, the open share is not counted and the answer says so.
      this.insight.isEnabled(),
    ]);
    const scope = reach.where();
    // The agents the caller reaches, as the agents list shows them.
    const reached = new Map<string, Named>(
      reach.filter(everyAgent, (agent) => agent.id).map((a) => [a.id, a]),
    );
    // The agents whose conversations are the caller's to count: the same
    // subtraction as `ChatController.supervised`, so this view and chat
    // history cannot disagree about whose a conversation is. Their spend
    // and their limit refusals are read over the same agents (CLEAN-268):
    // it is the cut `AgentReach.forRecords` makes for the usage overview.
    const talk = reach.without(ownerOnly);
    const talkScope = talk.where();
    const supervised = new Map<string, Named>(
      [...reached].filter(([id]) => talk.has(id)),
    );

    const [activity, ratings, usage, loadDays, incidents, notes] =
      await Promise.all([
        // One read for the conversations and for how they ended
        // (CLEAN-270): where summaries are produced, the statement that
        // counts the period's conversations also looks at the summary of
        // each. Where they are not, it is the statement it always was, and
        // no summary is read.
        this.activity.summaryForAgents(range, talkScope, {
          outcomes: summariesOn,
        }),
        this.chats.feedbackByAgent(range.from, range.to, talkScope),
        // Both periods in one read, and every agent's rows: the reach is
        // applied to them below exactly as the admin overview applies it,
        // which is what lets a deleted agent's spend through for a caller
        // with no allowed list and for nobody else.
        this.usage.findRange(range.previousFrom, endOfToday),
        this.limits.loadDays([...supervised.keys()], range.from, endOfToday),
        this.events.incidentsInRange({
          from: range.from,
          to: range.to,
          agentScope: scope,
          limit: INCIDENTS_SHOWN,
        }),
        // From the start of the previous period: the board compares with
        // it, so a figure that began inside either is partial somewhere on
        // the page.
        this.registry.notesFor(INSTALLATION_NOTED_FIGURES, range.previousFrom),
      ]);

    // Rows of agents the caller does not reach are dropped before anything
    // is summed, so no total carries them (CLEAN-231). Nor the rows of an
    // agent only the Owner manages, for anybody else (CLEAN-268).
    const visible = talk.filter(usage, (row) => row.agentId);
    const fromMs = range.from.getTime();
    const period = visible.filter((row) => row.date.getTime() >= fromMs);
    const spend = rollUpAcrossAgents(period);
    const before = rollUpAcrossAgents(
      visible.filter((row) => row.date.getTime() < fromMs),
    );
    const models = modelsOf(spend);

    // The queries have kept to the agents whose conversations the caller
    // may count. This is the second lock, and it drops a row whose agent was
    // deleted in the instant between the reads, so every block below names
    // the same agents.
    const conversations = activity.conversations.filter((row) =>
      supervised.has(row.agentId),
    );

    return {
      period: question.period,
      range,
      reach: {
        limited: !reach.unrestricted,
        agents: reached.size,
        // Only the ones the caller reaches: an agent outside the reach was
        // left out of everything for that, and is not named.
        ownerOnly: ownerOnly
          .map((id) => reached.get(id)?.name)
          .filter((name): name is string => name !== undefined)
          .sort((a, b) => a.localeCompare(b)),
      },
      notes,
      summaries: { enabled: summariesOn },
      board: {
        tokens: {
          input: spend.totals.inputTokens,
          output: spend.totals.outputTokens,
        },
        calls: {
          value: spend.totals.callCount,
          previous: before.totals.callCount,
        },
        cost: {
          // `costUsd` prices a model it does not know at nothing, so these
          // sums are of the priced models and the rest are named beside
          // them, never shown as free (FR-017).
          value: spend.totals.costUsd,
          previous: before.totals.costUsd,
          unpriced: models.filter((m) => !m.priced).map((m) => m.model),
        },
        people: activity.people,
      },
      daily: dailyOf(spend, shiftDay(today, -(question.period - 1)), today),
      models,
      agents: agentsOf(period, spend, reached),
      projection30d: projectionOf(
        spend,
        firstDayOf(visible),
        shiftDay(today, -(question.period - 1)),
        today,
      ),
      health: {
        incidents: incidents.items.map(incidentOf),
        incidentsTotal: incidents.total,
        refusals: refusalsOf(loadDays, supervised),
      },
      quality: qualityOf(
        conversations,
        ratings.filter((row) => supervised.has(row.agentId)),
        activity.outcomes.filter((row) => supervised.has(row.agentId)),
        supervised,
      ),
      channels: channelsOf(conversations),
    };
  }
}

/** Input and output together: what a bar of the chart is as tall as. */
const tokensOf = (row: { inputTokens: number; outputTokens: number }) =>
  row.inputTokens + row.outputTokens;

/** Add `amount` under `key`. */
function add<K>(totals: Map<K, number>, key: K, amount: number): void {
  totals.set(key, (totals.get(key) ?? 0) + amount);
}

/** Most first; equal ones by name, so the same rows give the same order. */
const byAmount = (a: readonly [string, number], b: readonly [string, number]) =>
  b[1] - a[1] || a[0].localeCompare(b[0]);

/** Every model used in the period, most tokens first, with its price mark. */
function modelsOf(spend: IUsageRollup): IInstallationModel[] {
  const tokens = new Map<string, number>();
  for (const entry of spend.last30days) {
    add(tokens, entry.model, tokensOf(entry));
  }
  return [...tokens]
    .sort(byAmount)
    .map(([model]) => ({ model, priced: hasPrice(model) }));
}

/**
 * One entry per UTC day from `firstDay` to `lastDay`, oldest first, a day
 * nobody reported usage for present with nothing. The roll-up has already
 * added the agents together per day and model.
 */
function dailyOf(
  spend: IUsageRollup,
  firstDay: string,
  lastDay: string,
): IInstallationDay[] {
  const days = new Map<string, { cost: number; tokens: Map<string, number> }>();
  for (let day = firstDay; day <= lastDay; day = shiftDay(day, 1)) {
    days.set(day, { cost: 0, tokens: new Map() });
  }
  for (const entry of spend.last30days) {
    const day = days.get(entry.date);
    if (!day) continue;
    day.cost += entry.costUsd;
    add(day.tokens, entry.model, tokensOf(entry));
  }
  return [...days].map(([date, day]) => ({
    date,
    cost: day.cost,
    byModel: [...day.tokens]
      .sort(byAmount)
      .map(([model, tokens]) => ({ model, tokens })),
  }));
}

/** The first UTC day any of these rows is for; null when there are none. */
function firstDayOf(rows: readonly IUsageData[]): string | null {
  let first: Date | null = null;
  for (const row of rows) {
    if (first === null || row.date < first) first = row.date;
  }
  return first ? localDay(first, UTC_ZONE) : null;
}

/**
 * USD for 30 days at the pace of the period's finished days.
 *
 * Today is left out of both the sum and the days: its row is still being
 * added to, and counting a part of a day as a day reads low by up to one day
 * in the period, a seventh of the figure on the 7-day view. Days before
 * anybody reported usage are left out for the same reason: an installation
 * four days old spent what it spent in four days, not in thirty. `firstReport`
 * is the first day among the rows already read, this period's and the one
 * before it: usage that began in the previous period counts every finished
 * day of this one, the quiet ones included, and nothing is read further back
 * to learn of a report older than that.
 *
 * Null when no day is finished yet: there is no pace to project, and that is
 * not a projection of nothing. Null too when no model with a price ran in
 * those days: `costUsd` prices a model it does not know at nothing, so the
 * sum is 0 and the page printed "≈ $0.00 in 30 days" above rows that all
 * said "no price" (second review, CLEAN-265). A priced model that cost
 * exactly nothing is a pace, and projects 0.
 */
function projectionOf(
  spend: IUsageRollup,
  firstReport: string | null,
  firstDay: string,
  today: string,
): number | null {
  if (firstReport === null || firstReport >= today) return null;
  const start = firstReport > firstDay ? firstReport : firstDay;
  let days = 0;
  for (let day = start; day < today; day = shiftDay(day, 1)) days += 1;
  let cost = 0;
  let priced = false;
  for (const entry of spend.last30days) {
    if (entry.date < start || entry.date >= today) continue;
    cost += entry.costUsd;
    priced ||= hasPrice(entry.model);
  }
  return priced ? (cost / days) * PROJECTION_DAYS : null;
}

/**
 * The agents that reported usage in the period, by cost.
 *
 * The sums are the roll-up's. What is added here is what the admin overview
 * does not show: which model took most of an agent's tokens, and whether
 * any of its models has a price at all. An agent that ran only models
 * outside the price list has no cost to state, which is not the same as
 * costing nothing: it is `null`, and it is listed after the ones that have
 * one, by tokens.
 *
 * An agent that still exists is shown under the name it has now. One that
 * was deleted keeps its usage (FR-031) and is shown under the name stored
 * with its rows, or its id when no report ever stored one: the rule
 * `resolveAgentNames` applies for the overview.
 */
function agentsOf(
  rows: readonly IUsageData[],
  spend: IUsageRollup,
  reached: ReadonlyMap<string, Named>,
): IInstallationAgent[] {
  const tokensByModel = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const models = tokensByModel.get(row.agentId) ?? new Map<string, number>();
    add(models, row.model, tokensOf(row));
    tokensByModel.set(row.agentId, models);
  }

  return spend.agentTotals
    .map((entry) => {
      const models = [...(tokensByModel.get(entry.agentId) ?? [])].sort(
        byAmount,
      );
      const live = reached.get(entry.agentId);
      const priced = models.filter(([model]) => hasPrice(model)).length;
      return {
        agentId: entry.agentId,
        name: live?.name ?? entry.agentName ?? entry.agentId,
        removed: live === undefined,
        model: models[0]?.[0] ?? '',
        tokens: tokensOf(entry),
        calls: entry.callCount,
        cost: priced > 0 ? entry.costUsd : null,
        // Some of what it ran has no price: the cost beside it is of the
        // rest, and the row says so instead of passing for the whole.
        partial: priced > 0 && priced < models.length,
      };
    })
    .sort(
      (a, b) =>
        Number(a.cost === null) - Number(b.cost === null) ||
        (b.cost ?? 0) - (a.cost ?? 0) ||
        b.tokens - a.tokens ||
        a.name.localeCompare(b.name) ||
        a.agentId.localeCompare(b.agentId),
    );
}

/**
 * What a period view shows of an incident. Not who witnessed it, where the
 * team was told or which agent id it had: the block says what happened to
 * which agent, when, and whether it is over.
 */
function incidentOf(incident: IAgentIncidentData): IInstallationIncident {
  return {
    number: incident.number,
    agentName: incident.agentName,
    open: incident.open,
    reason: incident.reason,
    openedAt: incident.openedAt,
    closedAt: incident.closedAt,
  };
}

/** Requests refused per agent over the period's days; only agents with any. */
function refusalsOf(
  days: readonly { agentId: string; refused: number }[],
  reached: ReadonlyMap<string, Named>,
): IInstallationRefusals[] {
  const refused = new Map<string, number>();
  for (const day of days) {
    if (reached.has(day.agentId)) add(refused, day.agentId, day.refused);
  }
  return [...refused]
    .filter(([, count]) => count > 0)
    .map(([agentId, count]) => ({
      agentId,
      name: reached.get(agentId)?.name ?? '',
      refused: count,
    }))
    .sort(
      (a, b) =>
        b.refused - a.refused ||
        a.name.localeCompare(b.name) ||
        a.agentId.localeCompare(b.agentId),
    );
}

/**
 * Per agent, the conversations people wrote in and the ratings its answers
 * got. An agent is listed when it has either: a rating can be given in the
 * period on an answer of an older conversation. `supervised` are the agents
 * whose conversations the caller may count, which names each row.
 *
 * `outcomes` says how many of an agent's conversations have a summary and
 * how many of those were left open (CLEAN-270); empty when the installation
 * produces none, and both are then 0.
 *
 * Neither is capped here. They were, while a statement of their own read
 * them a moment after the conversations were counted: a conversation that
 * moved in between could be in one answer and not in the other, and the
 * row was held to "open, of summarised, of conversations" by taking the
 * smaller. They are counted from the very rows the conversations are
 * counted from now (`agentConversationsQuery`), so the order holds by
 * construction, and the capping went with the statement that needed it.
 */
function qualityOf(
  conversations: readonly IAgentChannelConversations[],
  ratings: readonly IAgentFeedbackCounts[],
  outcomes: readonly IAgentOutcomeCounts[],
  supervised: ReadonlyMap<string, Named>,
): IInstallationQuality[] {
  const talked = new Map<string, number>();
  for (const row of conversations) add(talked, row.agentId, row.conversations);
  const rated = new Map(ratings.map((row) => [row.agentId, row]));
  const ended = new Map(outcomes.map((row) => [row.agentId, row]));

  return [...new Set([...talked.keys(), ...rated.keys()])]
    .map((agentId) => ({
      agentId,
      name: supervised.get(agentId)?.name ?? '',
      conversations: talked.get(agentId) ?? 0,
      down: rated.get(agentId)?.down ?? 0,
      rated: rated.get(agentId)?.rated ?? 0,
      open: ended.get(agentId)?.open ?? 0,
      summarised: ended.get(agentId)?.summarised ?? 0,
    }))
    .sort(
      (a, b) =>
        b.conversations - a.conversations ||
        a.name.localeCompare(b.name) ||
        a.agentId.localeCompare(b.agentId),
    );
}

/** Conversations by channel across the agents; a channel nobody used is absent. */
function channelsOf(
  conversations: readonly IAgentChannelConversations[],
): IInstallationChannel[] {
  const byChannel = new Map<ActivityChannel, number>();
  for (const row of conversations) {
    add(byChannel, row.channel, row.conversations);
  }
  return [...byChannel]
    .filter(([, count]) => count > 0)
    .sort(byAmount)
    .map(([channel, count]) => ({ channel, conversations: count }));
}
