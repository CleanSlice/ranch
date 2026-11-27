import { Injectable } from '@nestjs/common';
import { Prisma, ChatFeedback } from '@prisma/client';
import { PrismaService } from '#/setup/prisma/prisma.service';
import {
  IAgentFeedbackCounts,
  IChatGateway,
  IChatActivity,
  IChatAgentScope,
  IChatFeedbackCounts,
  IChatFeedbackData,
  IChatFilter,
  IChatInsightGate,
  IChatListResult,
  IChatReconcileInput,
  IChatSessionData,
  IChatSessionOutcome,
  IChatSessionRef,
  IChatSummaryData,
  INSIGHT_VERSION,
  IUpsertChatFeedback,
  hourOf,
} from '../domain';
import { ChatMapper } from './chat.mapper';

const DEFAULT_PER_PAGE = 50;

/**
 * How many conversation ids one statement names (CLEAN-258). A statement
 * carries a limited number of bound values (Prisma stops at 32 767 on
 * Postgres), and a person who talks a lot can have several thousand
 * conversations in 90 days. A thousand keeps each statement far below that
 * and small enough to plan as a lookup by primary key; nearly every view
 * fits in the first.
 */
const SESSION_ID_CHUNK = 1000;

/**
 * How long the live write may wait for a connection, and how long it may then
 * run (CLEAN-261). Prisma's defaults for an interactive transaction are 2 s
 * and 5 s. This one is started for every message, and nobody waits for it: a
 * burst larger than the connection pool made the ones at the back fail to
 * start after 2 s, and the event was lost from the lifetime totals too. When
 * the write was one bare statement it simply waited for a connection, and
 * waiting is still right, since the socket handler does not wait for the
 * result. An event that cannot start even after 15 s is given up on here and
 * repaired from the transcript by the settle pass.
 */
const ACTIVITY_TX_MAX_WAIT_MS = 15_000;
const ACTIVITY_TX_TIMEOUT_MS = 15_000;

@Injectable()
export class ChatGateway extends IChatGateway {
  constructor(
    private prisma: PrismaService,
    private mapper: ChatMapper,
  ) {
    super();
  }

  async list(filter: IChatFilter): Promise<IChatListResult> {
    const where = this.buildWhere(filter);
    const perPage = filter.perPage ?? DEFAULT_PER_PAGE;
    const page = filter.page ?? 1;

    const [records, total] = await this.prisma.$transaction([
      this.prisma.chatSession.findMany({
        where,
        orderBy: { lastMessageAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.chatSession.count({ where }),
    ]);

    return { items: records.map((r) => this.mapper.toEntity(r)), total };
  }

  async findById(id: string): Promise<IChatSessionData | null> {
    const record = await this.prisma.chatSession.findUnique({ where: { id } });
    return record ? this.mapper.toEntity(record) : null;
  }

  async reconcileUpsert(input: IChatReconcileInput): Promise<IChatSessionData> {
    const existing = await this.prisma.chatSession.findUnique({
      where: {
        agentId_sessionKey: {
          agentId: input.agentId,
          sessionKey: input.sessionKey,
        },
      },
    });

    const record = existing
      ? await this.prisma.chatSession.update({
          where: { id: existing.id },
          data: this.mapper.toReconcileUpdate(input, existing),
        })
      : await this.prisma.chatSession.create({
          data: this.mapper.toCreate(input),
        });

    return this.mapper.toEntity(record);
  }

  async archiveSession(
    agentId: string,
    sessionKey: string,
    archivedSessionKey: string,
  ): Promise<void> {
    // updateMany, not update: no row is the ordinary case of a conversation
    // that was never indexed, and must not throw.
    await this.prisma.chatSession.updateMany({
      where: { agentId, sessionKey },
      data: { sessionKey: archivedSessionKey, archived: true },
    });
  }

  /**
   * The lifetime totals and the event's hour move together or not at all
   * (CLEAN-261): one transaction, and the hour is written only when the
   * event was counted. So for a conversation the hours always add up to the
   * totals, and a repeated event moves neither.
   *
   * A failure rolls both back and reaches the caller, which logs it and does
   * not wait (the agent socket handler). The settle pass repairs the hour
   * from the transcript once the conversation has gone quiet.
   */
  async recordActivity(agentId: string, a: IChatActivity): Promise<void> {
    try {
      await this.recordActivityOnce(agentId, a);
    } catch (err) {
      // The hour row can appear between this transaction looking for it and
      // inserting it: the settle pass creates rows too. Postgres has ended
      // the transaction by then, the increment with it, so the retry is the
      // whole thing again, and it finds the row. Once: a second collision in
      // a row is not a race, and is the caller's to log.
      if ((err as { code?: string }).code !== 'P2002') throw err;
      await this.recordActivityOnce(agentId, a);
    }
  }

  private async recordActivityOnce(
    agentId: string,
    a: IChatActivity,
  ): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        const counted = await this.countActivity(tx, agentId, a);
        // A repeated event: the totals did not move, so neither does the hour.
        if (!counted) return;

        const fromPerson = a.role === 'user';
        const hour = hourOf(a.ts);
        await tx.chatActivityHour.upsert({
          where: { sessionId_hour: { sessionId: counted.id, hour } },
          create: {
            sessionId: counted.id,
            hour,
            agentId,
            channel: counted.channel,
            externalUserId: counted.externalUserId,
            userMessages: fromPerson ? 1 : 0,
            agentMessages: fromPerson ? 0 : 1,
          },
          update: fromPerson
            ? { userMessages: { increment: 1 } }
            : { agentMessages: { increment: 1 } },
        });
      },
      { maxWait: ACTIVITY_TX_MAX_WAIT_MS, timeout: ACTIVITY_TX_TIMEOUT_MS },
    );
  }

  /**
   * Counts the event in the lifetime totals. Returns the conversation it was
   * counted in, with the fields an hour row copies, or null for an event
   * that had been counted already.
   */
  private async countActivity(
    tx: Prisma.TransactionClient,
    agentId: string,
    a: IChatActivity,
  ): Promise<{ id: string; channel: string; externalUserId: string } | null> {
    // Atomic increment in the DB — no read-modify-write, so concurrent events
    // for the same session can't lose an increment. The NOT-filter dedups a
    // redelivered event (eventId watermark).
    if (await this.incrementActivity(tx, agentId, a)) {
      return this.activityOwner(tx, agentId, a.sessionKey);
    }

    // No row matched: either a brand-new session, or a duplicate event on an
    // existing one. Try to create it. `skipDuplicates` and not a caught
    // unique violation: inside a transaction Postgres refuses every
    // statement after an error, so there would be no "then increment".
    const data = this.mapper.toActivityCreate(agentId, a);
    const created = await tx.chatSession.createMany({
      data: [data],
      skipDuplicates: true,
    });
    if (created.count > 0) {
      return {
        id: data.id,
        channel: data.channel,
        externalUserId: data.externalUserId,
      };
    }

    // Nothing was created, so the row exists (created by a concurrent event,
    // or it's the dup) — re-run the increment, which applies for a real event
    // and no-ops for a dup. The insert waited for the concurrent creator to
    // commit, and under read committed, the default, this statement sees
    // what that one committed.
    if (await this.incrementActivity(tx, agentId, a)) {
      return this.activityOwner(tx, agentId, a.sessionKey);
    }
    return null;
  }

  /**
   * The conversation an increment just applied to. Its own channel and
   * person, not the event's: every hour of a conversation names the same
   * ones, the ones the settle pass copies too.
   */
  private activityOwner(
    tx: Prisma.TransactionClient,
    agentId: string,
    sessionKey: string,
  ): Promise<{ id: string; channel: string; externalUserId: string }> {
    // OrThrow: the increment holds the row's lock until the transaction
    // ends, so it is there. Were it not, the totals must not move alone.
    return tx.chatSession.findUniqueOrThrow({
      where: { agentId_sessionKey: { agentId, sessionKey } },
      select: { id: true, channel: true, externalUserId: true },
    });
  }

  private async incrementActivity(
    tx: Prisma.TransactionClient,
    agentId: string,
    a: IChatActivity,
  ): Promise<boolean> {
    const res = await tx.chatSession.updateMany({
      where: {
        agentId,
        sessionKey: a.sessionKey,
        // "Any event but the one counted last". Spelled as two branches
        // because SQL does not find a NULL unequal to anything: the single
        // `NOT (watermark = id)` this used to be was never true for a row
        // the reconcile created, which has no watermark, so such a
        // conversation took no live event at all: totals, preview and
        // lastMessageAt stood still until the next reconcile (CLEAN-261).
        OR: [
          { lastIndexedEventId: null },
          { lastIndexedEventId: { not: a.eventId } },
        ],
      },
      data: {
        messageCount: { increment: 1 },
        ...(a.role === 'user' ? { userMessageCount: { increment: 1 } } : {}),
        lastMessageAt: new Date(a.ts),
        preview: a.preview,
        lastRole: a.role,
        lastIndexedEventId: a.eventId,
        // Due for the settle pass again, which takes a conversation exactly
        // when this is null. In the statement that counts the event, so a
        // repeated event, which matches no row, does not touch it either.
        activityRebuiltAt: null,
      },
    });
    return res.count > 0;
  }

  async findEligibleForInsight(
    gate: IChatInsightGate,
  ): Promise<IChatSessionData[]> {
    const now = Date.now();
    const settledBefore = new Date(now - gate.cooldownMs);
    const resummarizeSince = new Date(now - gate.resummarizeWindowMs);
    const records = await this.prisma.chatSession.findMany({
      where: {
        channel: { not: 'internal' },
        // No condition on `archived` (CLEAN-270): a conversation closed
        // with New chat before its hour of quiet had passed was archived
        // unsummarised, and `archived: false` here kept it so for good.
        userMessageCount: { gte: gate.minUserMessages },
        lastMessageAt: { lt: settledBefore },
        OR: [
          // New activity since the last summary (null = never summarized).
          { summaryAt: null },
          { lastMessageAt: { gt: this.prisma.chatSession.fields.summaryAt } },
          // A summary by an older prompt, for a conversation recent enough
          // to be on a page that reads what the current prompt adds. Below
          // the version, not "equal to 1": a summary the previous release
          // wrote between the migration and its own replacement has a time
          // and version 0.
          {
            insightVersion: { lt: INSIGHT_VERSION },
            lastMessageAt: { gte: resummarizeSince },
          },
        ],
        // The ones the batch set aside and no longer reads in order to skip
        // (CLEAN-270, review). By id and last message together: with the id
        // alone a conversation would stay left out after the person wrote
        // in it again, which is when it is to be tried again. The caller
        // bounds the list; each entry is two values of the statement.
        ...(gate.exclude?.length
          ? {
              NOT: gate.exclude.map(({ id, lastMessageAt }) => ({
                id,
                lastMessageAt,
              })),
            }
          : {}),
      },
      orderBy: { lastMessageAt: 'desc' },
      take: gate.limit,
    });
    return records.map((r) => this.mapper.toEntity(r));
  }

  async saveInsights(id: string, data: IChatSummaryData): Promise<void> {
    await this.prisma.chatSession.update({
      where: { id },
      data: {
        summary: data.summary,
        question: data.question,
        outcome: data.outcome,
        topicIds: data.topicIds,
        insightVersion: INSIGHT_VERSION,
        insights: data.insights as unknown as Prisma.InputJsonValue,
        summaryAt: new Date(),
      },
    });
  }

  async upsertFeedback(i: IUpsertChatFeedback): Promise<IChatFeedbackData> {
    const record = await this.prisma.chatFeedback.upsert({
      where: {
        sessionId_messageId_authorId: {
          sessionId: i.sessionId,
          messageId: i.messageId,
          authorId: i.authorId,
        },
      },
      create: {
        id: `feedback-${crypto.randomUUID()}`,
        sessionId: i.sessionId,
        messageId: i.messageId,
        authorId: i.authorId,
        rating: i.rating,
        comment: i.comment ?? null,
        source: i.source,
      },
      update: { rating: i.rating, comment: i.comment ?? null },
    });
    return this.toFeedback(record);
  }

  async deleteFeedback(
    sessionId: string,
    messageId: string,
    authorId: string,
  ): Promise<void> {
    await this.prisma.chatFeedback.deleteMany({
      where: { sessionId, messageId, authorId },
    });
  }

  async listFeedbackByAuthor(
    sessionId: string,
    authorId: string,
  ): Promise<IChatFeedbackData[]> {
    const records = await this.prisma.chatFeedback.findMany({
      where: { sessionId, authorId },
      orderBy: { createdAt: 'desc' },
    });
    return records.map((r) => this.toFeedback(r));
  }

  async findSessionsByIds(
    ids: readonly string[],
    agentScope?: IChatAgentScope,
  ): Promise<IChatSessionRef[]> {
    const found: IChatSessionRef[] = [];
    for (const where of this.byIdInParts(ids, agentScope)) {
      const records = await this.prisma.chatSession.findMany({
        where,
        // Not the preview, the summary or the insights: a statistics view
        // shows nothing of what was said.
        select: { id: true, agentId: true, lastMessageAt: true },
      });
      found.push(...records);
    }
    return found;
  }

  async findOutcomesForSessions(
    ids: readonly string[],
    agentScope?: IChatAgentScope,
  ): Promise<IChatSessionOutcome[]> {
    const found: IChatSessionOutcome[] = [];
    for (const where of this.byIdInParts(ids, agentScope)) {
      const records = await this.prisma.chatSession.findMany({
        where,
        // What the summary judged, and what says whether one is to come.
        // Not `summary`, the preview or the title. `insights` is read for
        // the tone and the language, which have no column, and the mapper
        // passes on those two and nothing else of it.
        select: {
          id: true,
          agentId: true,
          lastMessageAt: true,
          userMessageCount: true,
          summaryAt: true,
          outcome: true,
          question: true,
          topicIds: true,
          insights: true,
        },
      });
      found.push(...records.map((r) => this.mapper.toOutcome(r)));
    }
    return found;
  }

  /**
   * "These conversations, of these agents" as one condition per
   * `SESSION_ID_CHUNK` ids, each id once: a lookup by primary key, as large
   * as the list it is given and no larger.
   */
  private byIdInParts(
    ids: readonly string[],
    agentScope?: IChatAgentScope,
  ): Prisma.ChatSessionWhereInput[] {
    const wanted = [...new Set(ids)];
    const parts: Prisma.ChatSessionWhereInput[] = [];
    for (let start = 0; start < wanted.length; start += SESSION_ID_CHUNK) {
      parts.push({
        id: { in: wanted.slice(start, start + SESSION_ID_CHUNK) },
        ...(agentScope ? { agentId: agentScope } : {}),
      });
    }
    return parts;
  }

  async countFeedbackByAuthor(
    authorId: string,
    from: Date,
    to: Date,
    agentScope?: IChatAgentScope,
  ): Promise<IChatFeedbackCounts> {
    const groups = await this.prisma.chatFeedback.groupBy({
      by: ['rating'],
      where: {
        // An equality and a range: the index on [authorId, createdAt].
        authorId,
        createdAt: { gte: from, lte: to },
        // A rating has no agent of its own; its conversation has. Joined
        // only for a caller whose lists hide some agent.
        ...(agentScope ? { session: { agentId: agentScope } } : {}),
      },
      _count: { _all: true },
    });
    const counts: IChatFeedbackCounts = { up: 0, down: 0 };
    for (const group of groups) {
      // 1 and -1 are what is written; the sign is read so that a weight
      // added one day is still a vote in its direction.
      if (group.rating > 0) counts.up += group._count._all;
      else if (group.rating < 0) counts.down += group._count._all;
    }
    return counts;
  }

  async feedbackByAgent(
    from: Date,
    to: Date,
    agentScope?: IChatAgentScope,
  ): Promise<IAgentFeedbackCounts[]> {
    // One row per rating of the range, two values each. Ratings are what
    // people click, a few for every hundred answers, so the range of the
    // index on [createdAt] is small where the hour rows of the same period
    // are not; `groupBy` cannot group by the conversation's agent, and this
    // does not need raw SQL to stay cheap.
    const records = await this.prisma.chatFeedback.findMany({
      where: {
        createdAt: { gte: from, lte: to },
        ...(agentScope ? { session: { agentId: agentScope } } : {}),
      },
      // The direction and the agent. Not the author, the comment or the
      // message: an installation view names no person and shows no text.
      select: { rating: true, session: { select: { agentId: true } } },
    });
    const byAgent = new Map<string, IAgentFeedbackCounts>();
    for (const record of records) {
      const agentId = record.session.agentId;
      const counts = byAgent.get(agentId) ?? { agentId, rated: 0, down: 0 };
      counts.rated += 1;
      // The sign, as `countFeedbackByAuthor` reads it.
      if (record.rating < 0) counts.down += 1;
      byAgent.set(agentId, counts);
    }
    return [...byAgent.values()].sort((a, b) =>
      a.agentId.localeCompare(b.agentId),
    );
  }

  async firstFeedbackAt(): Promise<Date | null> {
    // The first entry of the index on [createdAt].
    const first = await this.prisma.chatFeedback.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });
    return first?.createdAt ?? null;
  }

  private toFeedback(r: ChatFeedback): IChatFeedbackData {
    return {
      id: r.id,
      sessionId: r.sessionId,
      messageId: r.messageId,
      rating: r.rating,
      comment: r.comment,
      source: r.source,
      authorId: r.authorId,
      createdAt: r.createdAt,
    };
  }

  private buildWhere(filter: IChatFilter): Prisma.ChatSessionWhereInput {
    const where: Prisma.ChatSessionWhereInput = {};
    if (filter.agentId) where.agentId = filter.agentId;
    else if (filter.agentScope) where.agentId = filter.agentScope;
    if (filter.externalUserId) where.externalUserId = filter.externalUserId;

    if (filter.channel) where.channel = filter.channel;
    else if (!filter.includeInternal) where.channel = { not: 'internal' };

    if (filter.archived !== undefined) where.archived = filter.archived;

    if (filter.search) {
      where.OR = [
        { title: { contains: filter.search, mode: 'insensitive' } },
        { preview: { contains: filter.search, mode: 'insensitive' } },
      ];
      // Finding a visitor by id is for a list across people. In one
      // person's own list the id matches every row or none, so a search
      // that happens to be a piece of it would return everything
      // (CLEAN-248).
      if (!filter.externalUserId) {
        where.OR.push({
          externalUserId: { contains: filter.search, mode: 'insensitive' },
        });
      }
    }
    return where;
  }
}
