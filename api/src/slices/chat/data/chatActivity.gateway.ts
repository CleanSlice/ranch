import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PEER_CLIENT_PREFIX } from '#/agent/peer/domain/peer.types';
import { SHARE_CLIENT_PREFIX } from '#/agent/shareLink/domain/shareLink.types';
import { PrismaService } from '#/setup/prisma/prisma.service';
import {
  ChatChannelTypes,
  IActivityBucket,
  IActivityOwner,
  IActivityPeriods,
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
  peopleFromRows,
} from '../domain';

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
 * Memory one of these statements may hash in, set for its transaction only.
 *
 * Counting conversations is a hash of one entry per conversation of the
 * period, about 170 bytes each. Under the server's default of 4 MB the 245 000
 * conversations of a 90-day period in an installation of a million spilled
 * to disk in 17 passes and took 6.3 s; in memory the same statement takes
 * 0.3 s (measured, CLEAN-265). 64 MB, which Postgres doubles for a hash,
 * holds about 750 000 conversations in one period. Past that it spills again:
 * slower, never wrong. Local to the transaction, so the server's setting and
 * every other query keep what they had.
 */
export const AGGREGATE_WORK_MEM = '64MB';

/**
 * How long one of these statements may run, and wait for a connection. The
 * first read after a restart finds nothing cached and scans the table from
 * disk; the default of five seconds would end that with an error on a page
 * that a second try shows.
 */
const AGGREGATE_TIMEOUT_MS = 30_000;

/**
 * How many of these statements run at once in the process: two, the pair one
 * view asks for, so a single view still runs its two side by side and the
 * next view waits for a place.
 *
 * Each statement holds a connection of the Prisma pool for as long as it
 * runs, up to `AGGREGATE_TIMEOUT_MS`, and may hash in `AGGREGATE_WORK_MEM`,
 * which Postgres doubles: 128 MB each. Nothing capped how many ran, so a few
 * operators switching between 7, 30 and 90 days could hold the whole pool
 * while chat and sign-in waited for a connection (second review,
 * CLEAN-265). The API is one process by design: the hub, chat routing and
 * MCP sessions live in its memory (`ApiInstanceService`, CLEAN-140). So a
 * limit kept here is a limit on the installation. With two, the aggregates
 * take at most two connections and 256 MB, whoever is clicking.
 */
export const AGGREGATE_CONCURRENCY = 2;

/**
 * Places for `limit` tasks at a time, given out in the order they were asked
 * for. A task that ends, either way, hands its place to the one that has
 * waited longest, and frees it only when nobody waits: a newcomer cannot
 * slip in between an ending and the turn of the next in line.
 */
class Turns {
  private taken = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.taken < this.limit) {
      this.taken += 1;
    } else {
      // Resolved by the task that hands its place over, so `taken` already
      // counts this one when it wakes.
      await new Promise<void>((next) => this.waiting.push(next));
    }
    try {
      return await task();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.taken -= 1;
    }
  }
}

/** One queue for the process: every aggregate of every request is in it. */
const aggregateTurns = new Turns(AGGREGATE_CONCURRENCY);

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
 */
export function agentConversationsQuery(
  periods: Pick<IActivityPeriods, 'from' | 'to'>,
  scope: IAgentScopeCondition,
): Prisma.Sql {
  return Prisma.sql`
    SELECT c."agentId", c."channel", c."share", COUNT(*) AS "conversations"
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
    ) c
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
  ): Promise<IInstallationActivity> {
    const scope = agentScopeCondition(agentScope);
    // A caller who reaches no agent: nothing to count, and nothing asked.
    if (!scope.matchesAny) {
      return { conversations: [], people: { value: 0, previous: 0 } };
    }
    // Together: each takes its own connection and neither waits for the
    // other, once the pair has its turn (`AGGREGATE_CONCURRENCY`).
    // Conversations read the period, people the period and the one before
    // it.
    const [conversations, people] = await Promise.all([
      this.aggregate<IConversationCountRow>(
        agentConversationsQuery(periods, scope),
      ),
      this.aggregate<IPeopleCountRow>(peopleQuery(periods, scope)),
    ]);
    return {
      conversations: conversationsFromRows(conversations),
      people: peopleFromRows(people),
    };
  }

  /**
   * Run one aggregate with the two settings it needs, both made with
   * `set_config(…, true)`: that lasts until the transaction ends, so it has
   * to be in the same transaction as the statement, and it never reaches the
   * next user of the connection.
   *
   * `work_mem` is the memory to hash in (`AGGREGATE_WORK_MEM`).
   *
   * `plan_cache_mode = force_custom_plan` keeps the plan made for the dates
   * asked. The statement is prepared once per connection, and after its
   * fifth run Postgres may stop planning for the values and keep one plan
   * for any: not knowing how much of the table two unknown dates span, it
   * picked a plan that took 5.5 s where the first five runs took 0.6 s
   * (measured at a million conversations, CLEAN-265). Nothing but a sixth
   * request shows it, so no single `EXPLAIN` does.
   *
   * The statement first waits for its turn (`AGGREGATE_CONCURRENCY`), and
   * the transaction is opened only then. So `maxWait` counts the wait for a
   * connection and `timeout` the run, each from the statement's own turn:
   * neither counts the time spent in the queue, and a statement is not
   * ended for having waited behind others. What bounds that wait is the
   * ones ahead, each of which ends within its own timeout.
   */
  private aggregate<T>(statement: Prisma.Sql): Promise<T[]> {
    return aggregateTurns.run(() =>
      this.prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT set_config('work_mem', ${AGGREGATE_WORK_MEM}, true), set_config('plan_cache_mode', 'force_custom_plan', true)`;
          return tx.$queryRaw<T[]>(statement);
        },
        { maxWait: AGGREGATE_TIMEOUT_MS, timeout: AGGREGATE_TIMEOUT_MS },
      ),
    );
  }
}
