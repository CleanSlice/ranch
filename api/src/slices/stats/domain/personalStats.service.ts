import { Injectable } from '@nestjs/common';
import { IAgentGateway } from '#/agent/agent/domain/agent.gateway';
import { IDelegationGateway } from '#/agent/peer/domain/delegation.gateway';
import {
  IDelegationCounts,
  MASKED_PEER_NAME,
} from '#/agent/peer/domain/peer.types';
import { IChatGateway } from '#/chat/domain/chat.gateway';
import {
  ChatChannelTypes,
  IChatSessionRef,
  IPersonActivityHour,
} from '#/chat/domain/chat.types';
import { IChatActivityGateway } from '#/chat/domain/chatActivity.gateway';
import { ChatSourceService } from '#/chat/domain/chatSource.service';
import { ILlmGateway } from '#/llm/domain/llm.gateway';
import { IUsageGateway } from '#/usage/domain/usage.gateway';
import { IUsageData } from '#/usage/domain/usage.types';
import { AgentAccessService } from '#/user/agentAccess/domain/agentAccess.service';
import { AgentReach } from '#/user/agentAccess/domain/agentAccess.types';
import { FigureRegistry } from './figureRegistry';
import {
  IAgentDayMessages,
  IModelAttribution,
  attributeModels,
} from './modelAttribution';
import {
  IDayBucket,
  UTC_ZONE,
  bucketByDay,
  localDay,
  personalRange,
  resolveZone,
  shiftDay,
  startOfDay,
  weekdayOf,
} from './period';
import {
  IPersonalActivity,
  IPersonalAgent,
  IPersonalHelp,
  IPersonalStats,
  IStatsQuestion,
  IStatsViewer,
  PERSONAL_FIGURES,
} from './personalStats.types';

/**
 * The days of the calendar a person is shown: 13 whole weeks, whatever
 * period is asked for (spec 038, FR-006: "the last 13 weeks as a calendar,
 * days outside the selected period dimmed").
 */
export const CALENDAR_DAYS = 91;

/** How many of the most cited sources a view names (contracts/api.md). */
export const TOP_SOURCES = 2;

const HOUR_MS = 60 * 60 * 1000;

type Hours = readonly IPersonActivityHour[];

/**
 * A signed-in person's own statistics (CLEAN-258; spec 038, contracts/api.md
 * `GET /me/stats`), behind the route and the tool `get_my_stats` alike.
 *
 * It owns no fact. Every number is read through the slice that keeps it
 * (docs/statistics.md): hours of activity and ratings from `chat`, citations
 * from `chat`'s source service, hand-overs from `agent/peer`, calls per
 * model from `usage`, names and models from the agent and credential
 * gateways. What is done here is arithmetic over those rows: which day an
 * hour falls on, which period, which conversation, which model.
 *
 * Two things bound every read: the person (their chat identity, or their
 * account for ratings) and the agents they reach now. History with an agent
 * that was taken away from them is left out, as it is from their chat list,
 * and returns with the access (FR-022).
 */
@Injectable()
export class PersonalStatsService {
  constructor(
    private readonly activity: IChatActivityGateway,
    private readonly chats: IChatGateway,
    private readonly sources: ChatSourceService,
    private readonly delegations: IDelegationGateway,
    private readonly usage: IUsageGateway,
    private readonly agents: IAgentGateway,
    private readonly llms: ILlmGateway,
    private readonly access: AgentAccessService,
    private readonly registry: FigureRegistry,
  ) {}

  async forPerson(
    viewer: IStatsViewer,
    question: IStatsQuestion,
    now: Date = new Date(),
  ): Promise<IPersonalStats> {
    const zone = resolveZone(question.timeZone);
    const range = personalRange(question.period, zone, now);
    const calendarFrom = startOfDay(
      shiftDay(localDay(now, zone), -(CALENDAR_DAYS - 1)),
      zone,
    );
    // One read of the hours serves the period, the one before it and the
    // calendar. The calendar reaches back further for 7 and 30 days, the
    // previous period for 90 (180 days).
    const readFrom =
      calendarFrom.getTime() < range.previousFrom.getTime()
        ? calendarFrom
        : range.previousFrom;

    const reach = await this.access.reachableIds(viewer.caller);
    const scope = reach.where();

    const [hours, everyAgent, ratings, cited, handovers, notes] =
      await Promise.all([
        this.activity.findHoursForPerson(
          viewer.clientId,
          ChatChannelTypes.Bridle,
          readFrom,
          now,
          scope,
        ),
        this.agents.findAll(),
        // By the account, not the chat identity: a rating names the person
        // who gave it, and the Owner's are under their own id too.
        this.chats.countFeedbackByAuthor(
          viewer.userId,
          range.from,
          range.to,
          scope,
        ),
        this.sources.citedForClient(
          viewer.clientId,
          range.from,
          range.to,
          scope,
        ),
        this.delegations.countForClient(
          viewer.clientId,
          range.from,
          range.to,
          scope,
        ),
        // Each figure against the stretch it is shown for. Activity is on
        // screen as far back as the calendar or the previous period reach,
        // whichever is further. Ratings, citations and hand-overs are read
        // in place and never carry a note (CLEAN-262): their rows are the
        // source, so "none before that day" means nothing happened, not
        // that something was missed. They are asked for all the same, for
        // the period itself, so that a figure of this block that one day
        // becomes a recorded one is noted without a change here.
        Promise.all([
          this.registry.notesFor(['activity'], readFrom),
          this.registry.notesFor(
            PERSONAL_FIGURES.filter((key) => key !== 'activity'),
            range.from,
          ),
        ]).then((parts) => parts.flat()),
      ]);

    // The agents this person reaches, as the agents list shows them.
    const reached = new Map(
      reach.filter(everyAgent, (agent) => agent.id).map((a) => [a.id, a]),
    );
    // The query has already kept to the reached agents. This is the second
    // lock, and it also drops an hour whose agent was deleted in the instant
    // between the two reads, so every block below names the same agents.
    const mine = hours.filter((row) => reached.has(row.agentId));
    const fromMs = range.from.getTime();
    const previousMs = range.previousFrom.getTime();
    const current = mine.filter((row) => row.hour.getTime() >= fromMs);
    const previous = mine.filter((row) => {
      const at = row.hour.getTime();
      return at >= previousMs && at < fromMs;
    });

    // A conversation is counted when the person writes in it (spec 038,
    // edge cases and assumptions): an hour of answers alone, a scheduled
    // message say, is not a conversation of theirs that day.
    const written = current.filter(wroteIn);
    const conversationIds = distinct(written.map((row) => row.sessionId));
    const writtenAgentIds = distinct(written.map((row) => row.agentId)).sort();

    // The credentials of the agents the person wrote to, and no others: a
    // model is shown for those agents only, and a credential also holds a
    // key that has no business being read for a page of statistics.
    const credentialIds = distinct(
      writtenAgentIds
        .map((agentId) => reached.get(agentId)?.llmCredentialId)
        .filter((id): id is string => typeof id === 'string' && id !== ''),
    );

    const [sessions, usage, credentials] = await Promise.all([
      this.chats.findSessionsByIds(conversationIds, scope),
      // Usage is kept by UTC day, so it is asked for the UTC days the
      // period touches: from the day its first instant falls on to the end
      // of today.
      this.usage.findRange(
        startOfDay(localDay(range.from, UTC_ZONE), UTC_ZONE),
        startOfDay(shiftDay(localDay(now, UTC_ZONE), 1), UTC_ZONE),
        writtenAgentIds,
      ),
      Promise.all(credentialIds.map((id) => this.llms.findById(id))),
    ]);

    // Only the model's name is taken from a credential. Its key, its label
    // and its id stay where they are. A credential that is gone leaves the
    // agent without a current model.
    const modelOfCredential = new Map<string, string>();
    for (const credential of credentials) {
      if (credential) modelOfCredential.set(credential.id, credential.model);
    }
    const currentModel = (agentId: string): string | null => {
      const credentialId = reached.get(agentId)?.llmCredentialId;
      return credentialId
        ? (modelOfCredential.get(credentialId) ?? null)
        : null;
    };

    const days = bucketByDay(mine.filter(wroteIn), zone, CALENDAR_DAYS, now);

    return {
      period: question.period,
      timeZone: zone,
      range,
      notes,
      board: {
        conversations: {
          value: conversationIds.length,
          previous: distinct(previous.filter(wroteIn).map((r) => r.sessionId))
            .length,
        },
        messages: {
          value: sum(current, (row) => row.userMessages),
          previous: sum(previous, (row) => row.userMessages),
        },
        agents: {
          value: distinct(
            current.filter((r) => r.agentMessages > 0).map((r) => r.agentId),
          ).length,
          reachable: reached.size,
        },
      },
      activity: activityOf(days, question.period),
      agents: agentsOf(
        written,
        sessions.filter((session) => reached.has(session.agentId)),
        (agentId) => reached.get(agentId)?.name ?? '',
        currentModel,
      ),
      help: {
        cited: {
          conversations: citedConversations(
            current,
            new Set(conversationIds),
            cited.answers,
          ),
          sources: cited.sources.slice(0, TOP_SOURCES),
        },
        handovers: {
          total: handovers.total,
          answered: handovers.answered,
          topPeer: topPeerOf(handovers, reach),
        },
        ratings,
      },
      models: modelsOf(written, usage, currentModel, now),
    };
  }
}

const wroteIn = (row: IPersonActivityHour): boolean => row.userMessages > 0;

function distinct<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function sum<T>(rows: readonly T[], of: (row: T) => number): number {
  let total = 0;
  for (const row of rows) total += of(row);
  return total;
}

/**
 * The calendar, and the period's part of it by weekday. The period is the
 * last N days of the calendar (the longest period is 90 days, the calendar
 * 91), so its days are taken from the buckets rather than counted again.
 */
function activityOf(
  days: readonly IDayBucket[],
  period: number,
): IPersonalActivity {
  const weekdays = [0, 0, 0, 0, 0, 0, 0];
  let activeDays = 0;
  for (const day of days.slice(-period)) {
    weekdays[weekdayOf(day.day)] += day.conversations;
    if (day.conversations > 0) activeDays += 1;
  }
  return {
    days: days.map((day) => ({
      date: day.day,
      conversations: day.conversations,
    })),
    weekdays,
    activeDays,
  };
}

/**
 * The agents the person wrote to in the period, by their messages. `written`
 * holds only hours the person wrote in; `sessions` are the conversations of
 * those hours, for the time of the last message in each.
 */
function agentsOf(
  written: Hours,
  sessions: readonly IChatSessionRef[],
  nameOf: (agentId: string) => string,
  currentModel: (agentId: string) => string | null,
): IPersonalAgent[] {
  const byAgent = new Map<
    string,
    { messages: number; conversations: Set<string> }
  >();
  for (const row of written) {
    const agent = byAgent.get(row.agentId) ?? {
      messages: 0,
      conversations: new Set<string>(),
    };
    agent.messages += row.userMessages;
    agent.conversations.add(row.sessionId);
    byAgent.set(row.agentId, agent);
  }

  const lastMessageAt = new Map<string, Date>();
  for (const session of sessions) {
    const latest = lastMessageAt.get(session.agentId);
    if (!latest || session.lastMessageAt.getTime() > latest.getTime()) {
      lastMessageAt.set(session.agentId, session.lastMessageAt);
    }
  }

  return [...byAgent]
    .map(([agentId, agent]) => ({
      agentId,
      name: nameOf(agentId),
      messages: agent.messages,
      conversations: agent.conversations.size,
      model: currentModel(agentId),
      lastMessageAt: lastMessageAt.get(agentId) ?? null,
    }))
    .sort(
      (a, b) =>
        b.messages - a.messages ||
        a.name.localeCompare(b.name) ||
        a.agentId.localeCompare(b.agentId),
    );
}

/**
 * How many of the period's conversations got an answer with sources.
 *
 * A citation names its agent and its moment, not its conversation: the row
 * has no key to one (`sessionKey` is the same for every conversation a
 * person has with an agent) and is kept after the conversation is gone. A
 * person has one conversation at a time with an agent, so the answer
 * belongs to the conversation with that agent that was active in that hour.
 *
 * Looked for in the answer's own hour first, then in the hour before and
 * the hour after: the sources and the message are reported by two events a
 * moment apart, and either can land across the hour from the other. Not
 * further, or an answer would find a conversation it was not part of.
 *
 * When two conversations with the agent share the hour (New chat pressed
 * inside it) the hour cannot say which the answer belongs to. It is counted
 * for one of them, never both, so the figure cannot overstate.
 *
 * Only conversations the person wrote in during the period can be found,
 * so this never exceeds the period's conversations.
 */
function citedConversations(
  current: Hours,
  conversations: ReadonlySet<string>,
  answers: readonly { agentId: string; at: Date }[],
): number {
  const key = (agentId: string, hourMs: number) => `${agentId}|${hourMs}`;
  // Every hour of the period's conversations, the ones in which only the
  // agent wrote included: an answer often lands in the hour after the
  // question.
  const active = new Map<string, IPersonActivityHour[]>();
  for (const row of current) {
    if (!conversations.has(row.sessionId)) continue;
    const at = key(row.agentId, row.hour.getTime());
    active.set(at, [...(active.get(at) ?? []), row]);
  }

  const cited = new Set<string>();
  for (const answer of answers) {
    const hourMs = Math.floor(answer.at.getTime() / HOUR_MS) * HOUR_MS;
    const rows =
      active.get(key(answer.agentId, hourMs)) ??
      active.get(key(answer.agentId, hourMs - HOUR_MS)) ??
      active.get(key(answer.agentId, hourMs + HOUR_MS));
    if (!rows) continue;
    // The conversation the agent wrote in that hour, if only one did; then
    // by id, so the same rows always give the same answer.
    const [owner] = [...rows].sort(
      (a, b) =>
        Number(b.agentMessages > 0) - Number(a.agentMessages > 0) ||
        a.sessionId.localeCompare(b.sessionId),
    );
    cited.add(owner.sessionId);
  }
  return cited.size;
}

/**
 * The peer asked most, under a name this person may be told.
 *
 * An agent can ask a colleague the person does not reach, through a
 * connection open to visitors. The chat then says "a colleague" and never
 * the name (CLEAN-236, `delegationStep.ts`), and so does this: the count is
 * the person's own experience, the name is not theirs to learn. An agent
 * outside this Ranch has no access list; it served them under its name.
 */
function topPeerOf(
  handovers: IDelegationCounts,
  reach: AgentReach,
): IPersonalHelp['handovers']['topPeer'] {
  const top = handovers.peers[0];
  if (!top) return null;
  const hidden = top.peerAgentId !== null && !reach.has(top.peerAgentId);
  return { name: hidden ? MASKED_PEER_NAME : top.name, count: top.count };
}

/**
 * The person's messages of the period by the model that answered them
 * (`modelAttribution.ts`): their messages per agent and UTC day, against
 * the calls that agent reported for that day.
 */
function modelsOf(
  written: Hours,
  usage: readonly IUsageData[],
  currentModel: (agentId: string) => string | null,
  now: Date,
): IModelAttribution {
  const perAgentDay = new Map<string, IAgentDayMessages>();
  for (const row of written) {
    const day = localDay(row.hour, UTC_ZONE);
    const at = `${row.agentId}|${day}`;
    const entry = perAgentDay.get(at) ?? {
      agentId: row.agentId,
      day,
      messages: 0,
    };
    entry.messages += row.userMessages;
    perAgentDay.set(at, entry);
  }
  return attributeModels(
    [...perAgentDay.values()],
    usage.map((row) => ({
      agentId: row.agentId,
      day: localDay(row.date, UTC_ZONE),
      model: row.model,
      calls: row.callCount,
    })),
    currentModel,
    localDay(now, UTC_ZONE),
  );
}
