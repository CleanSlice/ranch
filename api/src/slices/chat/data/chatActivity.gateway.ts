import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PEER_CLIENT_PREFIX } from '#/agent/peer/domain/peer.types';
import { SHARE_CLIENT_PREFIX } from '#/agent/shareLink/domain/shareLink.types';
import { PrismaService } from '#/setup/prisma/prisma.service';
import {
  ChatChannelTypes,
  ChatOutcomeTypes,
  IActivityBucket,
  IActivityOwner,
  IActivityPeriods,
  IActivitySummaryOptions,
  IAgentScopeCondition,
  IChatActivityGateway,
  IChatAgentScope,
  IChatSettleGate,
  IConversationCountRow,
  IInstallationActivity,
  IPeopleCountRow,
  IPersonActivityHour,
  IUnsettledChat,
  agentScopeCondition,
  conversationsFromRows,
  outcomesFromRows,
  peopleFromRows,
} from '../domain';
import { runAggregate } from './aggregate';

// ── The installation's activity, counted in the database (CLEAN-265) ──
//
// Two statements over `ChatActivityHour`, built here as values so that a spec
// can read what each says and what it binds. Every value is a parameter:
// the dates, the two prefixes and each agent id. Nothing is written into
// the text.
//
// Neither uses COUNT(DISTINCT …). That aggregate sorts its input, in one
// process; over the hour rows of 180 days it is the slow way to the same
// number. Each statement instead brings the rows down to one per thing
// counted with a GROUP BY, which Postgres does by hashing and can spread
// over parallel workers, and then counts those rows.
//
// Both are bound by `hour` and, for a caller who does not reach every agent,
// by `agentId`: the index on [agentId, hour] answers a caller limited to a
// few agents, the one on [hour] or a scan of the table the rest.

/** An identity `LIKE` pattern: everything that starts with `prefix`. */
const startingWith = (prefix: string) => `${prefix}%`;

/**
 * A moment as the value `hour` holds for it.
 *
 * `hour` is a `timestamp` without a zone, and what is in it is UTC. A `Date`
 * bound into raw SQL arrives as a `timestamptz`, and Postgres compares the
 * two by reading the column in the zone of the session: on a database whose
 * session is not UTC every boundary moves by that zone's offset, and nothing
 * fails. It was measured on a session in Europe/Kyiv: a 7-day period began
 * two hours late and counted 16 244 conversations of 16 472 (CLEAN-265).
 * Saying the zone here makes the comparison the same on any server.
 */
const utc = (moment: Date) =>
  Prisma.sql`(${moment}::timestamptz AT TIME ZONE 'UTC')`;

/**
 * The caller's agents as SQL, ready to follow the other conditions. Each id
 * is a bound value. A list has as many ids as the installation has agents;
 * a statement may carry 32 767 values.
 */
function agentCondition(scope: IAgentScopeCondition): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  if (scope.in) {
    parts.push(Prisma.sql`AND "agentId" IN (${Prisma.join(scope.in)})`);
  }
  if (scope.notIn) {
    parts.push(Prisma.sql`AND "agentId" NOT IN (${Prisma.join(scope.notIn)})`);
  }
  return parts.length ? Prisma.join(parts, ' ') : Prisma.empty;
}

/**
 * Conversations a person wrote in during `[from, to]`, by agent, stored
 * channel and whether the identity is a share visitor's.
 *
 * The inner query answers one row per conversation: a conversation keeps
 * its agent, channel and identity for good, so grouping by all four is
 * grouping by the conversation, and the outer query counts rows. Which of
 * the five channels of the view a row is, is decided from `channel` and
 * `share` afterwards (`activityChannelOf`), where a spec holds the rule.
 *
 * With `withOutcomes` (CLEAN-270) each of those rows is also joined to its
 * conversation, by primary key, for how it ended: `summarised` counts the
 * ones that have a summary and `open` the ones among them it left open.
 * `unknown`, and a summary with no outcome at all (one an older release
 * wrote), are summarised and not open. A LEFT join with "has a summary" in
 * its condition, so a conversation without one keeps its row and
 * `conversations` is the number it is without the join. Two columns of
 * `ChatSession` are read, `summaryAt` and `outcome`: not the question, the
 * summary or anything else a person's words are in (FR-021, FR-033).
 *
 * In this statement and not in one of its own. It was a third statement
 * for a day, and scanned and hashed the hour rows this one had just scanned
 * and hashed. Measured on a database of 1 005 120 conversations, 300 912 of
 * them summarised, over 90 days (245 133 conversations): the third
 * statement took 0.95 to 1.1 s warm and 1.7 s cold and, waiting its turn
 * behind the pair, took the view from 0.65 s to about 1.65 s. Folded in,
 * this statement takes 0.92 to 1.08 s where it took 0.3 s, beside the
 * people statement's 0.6 s, so the view is about 1.0 s. The counts were
 * checked against a separate recount (36 733 summarised and 12 207 open
 * of one agent's 123 201 conversations).
 *
 * What the second takes is the join: a sequential scan of `ChatSession`
 * for two columns. If that has to be cheaper, the step is a partial index
 * `("id") INCLUDE ("outcome") WHERE "summaryAt" IS NOT NULL`, written by
 * hand in a migration; it was measured at 0.6 to 0.85 s for the inner-join
 * form and is not built.
 *
 * Without `withOutcomes` the statement is the one that has shipped since
 * CLEAN-265, to the letter: an installation that produces no summaries,
 * the ordinary one, does not read `ChatSession` for its statistics.
 */
export function agentConversationsQuery(
  periods: Pick<IActivityPeriods, 'from' | 'to'>,
  scope: IAgentScopeCondition,
  withOutcomes = false,
): Prisma.Sql {
  const outcomeCounts = withOutcomes
    ? Prisma.sql`,
           COUNT(s."id") AS "summarised",
           COUNT(*) FILTER (WHERE s."outcome" = ${ChatOutcomeTypes.Open}) AS "open"`
    : Prisma.empty;
  const summaryOfEach = withOutcomes
    ? Prisma.sql`
    LEFT JOIN "ChatSession" s
      ON s."id" = c."sessionId" AND s."summaryAt" IS NOT NULL`
    : Prisma.empty;
  return Prisma.sql`
    SELECT c."agentId", c."channel", c."share", COUNT(*) AS "conversations"${outcomeCounts}
    FROM (
      SELECT "sessionId", "agentId", "channel",
             ("externalUserId" LIKE ${startingWith(SHARE_CLIENT_PREFIX)}) AS "share"
      FROM "ChatActivityHour"
      WHERE "hour" >= ${utc(periods.from)} AND "hour" <= ${utc(periods.to)}
        AND "userMessages" > 0
        AND "channel" <> ${ChatChannelTypes.Internal}
        AND "externalUserId" NOT LIKE ${startingWith(PEER_CLIENT_PREFIX)}
        ${agentCondition(scope)}
      GROUP BY "sessionId", "agentId", "channel", "externalUserId"
    ) c${summaryOfEach}
    GROUP BY c."agentId", c."channel", c."share"`;
}

/**
 * Distinct people who wrote, in `[from, to]` and in `[previousFrom, from)`,
 * from one pass over both periods.
 *
 * The inner query answers one row per identity with two flags: whether any
 * of its hours falls in the period, and whether any falls before it. The
 * outer query counts the rows under each flag, so a person who wrote in
 * both periods is one in each. The identity is grouped on and never
 * selected: the answer is two numbers.
 */
export function peopleQuery(
  periods: IActivityPeriods,
  scope: IAgentScopeCondition,
): Prisma.Sql {
  return Prisma.sql`
    SELECT COUNT(*) FILTER (WHERE p."inPeriod") AS "value",
           COUNT(*) FILTER (WHERE p."inPrevious") AS "previous"
    FROM (
      SELECT bool_or("hour" >= ${utc(periods.from)}) AS "inPeriod",
             bool_or("hour" < ${utc(periods.from)}) AS "inPrevious"
      FROM "ChatActivityHour"
      WHERE "hour" >= ${utc(periods.previousFrom)} AND "hour" <= ${utc(periods.to)}
        AND "userMessages" > 0
        AND "channel" <> ${ChatChannelTypes.Internal}
        AND "externalUserId" NOT LIKE ${startingWith(PEER_CLIENT_PREFIX)}
        ${agentCondition(scope)}
      GROUP BY "externalUserId"
    ) p`;
}

@Injectable()
export class ChatActivityGateway extends IChatActivityGateway {
  constructor(private prisma: PrismaService) {
    super();
  }

  async findUnsettled(gate: IChatSettleGate): Promise<IUnsettledChat[]> {
    const records = await this.prisma.chatSession.findMany({
      where: {
        // Due is one value of one column: null. Everything that moves a
        // conversation on puts it back to null (a counted live event, a
        // reconcile of a changed file), so this is one range of the index
        // on [activityRebuiltAt, lastMessageAt]. "Stamp older than the last
        // message" compared a column with a column, which no index answers:
        // every run walked every conversation of the last 180 days to find,
        // most of the time, none.
        activityRebuiltAt: null,
        lastMessageAt: { lt: gate.quietBefore, gte: gate.activeSince },
      },
      orderBy: { lastMessageAt: 'desc' },
      take: gate.limit,
      // Up to a batch of rows every few minutes: not the preview, the
      // summary or the insights, which the pass has no use for.
      select: {
        id: true,
        agentId: true,
        sessionKey: true,
        channel: true,
        externalUserId: true,
        lastMessageAt: true,
      },
    });
    return records.map((r) => ({
      id: r.id,
      agentId: r.agentId,
      sessionKey: r.sessionKey,
      channel: r.channel,
      externalUserId: r.externalUserId,
      lastMessageAt: r.lastMessageAt,
    }));
  }

  async raise(
    session: IActivityOwner,
    rows: IActivityBucket[],
  ): Promise<number> {
    if (!rows.length) return 0;

    const stored = await this.prisma.chatActivityHour.findMany({
      where: { sessionId: session.id, hour: { in: rows.map((r) => r.hour) } },
    });
    const storedByHour = new Map(stored.map((s) => [s.hour.getTime(), s]));

    // Not in a transaction with the read above, and it does not need one:
    // each statement below is safe by itself against a live event writing
    // the same hour at the same moment. The insert skips a row that has
    // appeared, the update carries its floor in its own condition.
    const missing = rows.filter((r) => !storedByHour.has(r.hour.getTime()));
    let created = 0;
    if (missing.length) {
      const res = await this.prisma.chatActivityHour.createMany({
        data: missing.map((r) => ({
          sessionId: session.id,
          hour: r.hour,
          agentId: session.agentId,
          channel: session.channel,
          externalUserId: session.externalUserId,
          userMessages: r.userMessages,
          agentMessages: r.agentMessages,
        })),
        skipDuplicates: true,
      });
      created = res.count;
    }
    // Fewer created than were missing: a live event created one of them
    // first. Which one is not known, so all of them are offered the raise;
    // for the ones created here it changes nothing.
    const createdAll = created === missing.length;

    let raised = 0;
    for (const row of rows) {
      const before = storedByHour.get(row.hour.getTime());
      if (!before && createdAll) continue;
      if (
        before &&
        before.userMessages >= row.userMessages &&
        before.agentMessages >= row.agentMessages
      ) {
        continue;
      }
      if (await this.raiseHour(session.id, row)) raised++;
    }
    return created + raised;
  }

  /**
   * "Set to the count where the stored one is lower", with the comparison in
   * the statement and not in a value read earlier: an increment that lands in
   * between is seen, and the count is never lowered. One statement per count,
   * because each has its own floor.
   */
  private async raiseHour(
    sessionId: string,
    row: IActivityBucket,
  ): Promise<boolean> {
    const user = await this.prisma.chatActivityHour.updateMany({
      where: {
        sessionId,
        hour: row.hour,
        userMessages: { lt: row.userMessages },
      },
      data: { userMessages: row.userMessages },
    });
    const agent = await this.prisma.chatActivityHour.updateMany({
      where: {
        sessionId,
        hour: row.hour,
        agentMessages: { lt: row.agentMessages },
      },
      data: { agentMessages: row.agentMessages },
    });
    return user.count + agent.count > 0;
  }

  async markSettled(sessionId: string, at: Date): Promise<void> {
    // Only a conversation that has not moved on since the run began. A
    // message that arrived while the transcript was being read has a later
    // lastMessageAt and has already put the column back to null; without the
    // condition this stamp would overwrite that null, and with null being
    // the only thing that makes a conversation due, the message would wait
    // for the one after it to be counted from the transcript.
    //
    // updateMany, not update: a conversation deleted while its transcript was
    // being read is no row, and must not throw. Neither must one that moved
    // on.
    await this.prisma.chatSession.updateMany({
      where: { id: sessionId, lastMessageAt: { lte: at } },
      data: { activityRebuiltAt: at },
    });
  }

  async pruneBefore(date: Date): Promise<number> {
    const res = await this.prisma.chatActivityHour.deleteMany({
      where: { hour: { lt: date } },
    });
    return res.count;
  }

  findHoursForPerson(
    externalUserId: string,
    channel: string,
    from: Date,
    to: Date,
    agentScope?: IChatAgentScope,
  ): Promise<IPersonActivityHour[]> {
    return this.prisma.chatActivityHour.findMany({
      where: {
        // Two equalities and a range: exactly the index on
        // [externalUserId, channel, hour], so the read costs what this
        // person did in the range and nothing of anybody else's.
        externalUserId,
        channel,
        hour: { gte: from, lte: to },
        // The agents the person reaches, as `buildWhere` of the chat list
        // applies them. No key at all without a list: `agentId: undefined`
        // would mean the same to Prisma, and reads as a filter that is not
        // there.
        ...(agentScope ? { agentId: agentScope } : {}),
      },
      select: {
        sessionId: true,
        agentId: true,
        hour: true,
        userMessages: true,
        agentMessages: true,
      },
      orderBy: { hour: 'asc' },
    });
  }

  async summaryForAgents(
    periods: IActivityPeriods,
    agentScope?: IChatAgentScope,
    options: IActivitySummaryOptions = {},
  ): Promise<IInstallationActivity> {
    const scope = agentScopeCondition(agentScope);
    // A caller who reaches no agent: nothing to count, and nothing asked.
    if (!scope.matchesAny) {
      return {
        conversations: [],
        outcomes: [],
        people: { value: 0, previous: 0 },
      };
    }
    // Together: each takes its own connection and neither waits for the
    // other, once the pair has its turn (`AGGREGATE_CONCURRENCY`).
    // Conversations read the period, people the period and the one before
    // it. How the conversations ended, when asked, is counted by the
    // statement that counts them (CLEAN-270): still a pair, and the hour
    // rows are scanned and hashed once for both.
    const [conversations, people] = await Promise.all([
      runAggregate<IConversationCountRow>(
        this.prisma,
        agentConversationsQuery(periods, scope, options.outcomes === true),
      ),
      runAggregate<IPeopleCountRow>(this.prisma, peopleQuery(periods, scope)),
    ]);
    return {
      conversations: conversationsFromRows(conversations),
      // Empty unless asked: the rows then carry no outcome to add up.
      outcomes: outcomesFromRows(conversations),
      people: peopleFromRows(people),
    };
  }
}
