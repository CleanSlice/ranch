import { Injectable } from '@nestjs/common';
import { ChatTopic, Prisma } from '@prisma/client';
import { PrismaService } from '#/setup/prisma/prisma.service';
import {
  ChatTopicMergeRefused,
  IAgentScopeCondition,
  IChatAgentScope,
  IChatTopicData,
  IChatTopicGateway,
  IChatTopicLabels,
  IChatTopicUsage,
  TOPICS_STANDING_MAX,
  agentScopeCondition,
  offeredTopics,
  topicMergeRefusal,
  topicUsage,
} from '../domain';
import { runAggregate } from './aggregate';

/** The caller's agents as SQL, each id a bound value. */
function agentCondition(scope: IAgentScopeCondition): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  if (scope.in) {
    parts.push(Prisma.sql`AND s."agentId" IN (${Prisma.join(scope.in)})`);
  }
  if (scope.notIn) {
    parts.push(
      Prisma.sql`AND s."agentId" NOT IN (${Prisma.join(scope.notIn)})`,
    );
  }
  return parts.length ? Prisma.join(parts, ' ') : Prisma.empty;
}

/**
 * How many conversations carry each topic (CLEAN-270), read from the
 * conversations themselves: `ChatSession.topicIds` is where the fact is, and
 * a counter on the topic would be a copy of it (docs/statistics.md).
 *
 * For each conversation the inner query turns the ids it carries, two at
 * most, into the topics that stand for them (a merged topic is read as the
 * one it was folded into) and keeps each once; the outer query counts
 * conversations by topic. The deduplication is per conversation, over two
 * rows, so nothing large is hashed or sorted: the outer hash has one entry
 * per topic.
 *
 * What it costs is one pass over `ChatSession`: Prisma's schema cannot
 * declare an index that would narrow it to the rows with a topic. Measured
 * on a database of 1 005 120 conversations, 300 912 of them with a topic,
 * and 60 topics (CLEAN-270): 0.5 to 0.7 s, a sequential scan, 55 rows back
 * with the merged topics folded into their targets. That is paid once per
 * call of `list_chat_topics` and once per run of the summary batch, which
 * keeps its own tally from then on (`ChatInsightService`): read for each of
 * a run's 25 conversations, as it first was, it came to about 15 s of
 * scanning per run at that size. If it has to be cheaper than one pass, the
 * step is a partial index on the rows whose `topicIds` is not empty,
 * written by hand in a migration.
 *
 * It runs the way the activity aggregates run (`runAggregate`, CLEAN-270,
 * review), and in their queue: a transaction of its own with thirty seconds
 * where a bare statement has the client's five, which a first pass after a
 * restart, read from disk, can outlast; the plan made for the agent ids
 * bound, where from the sixth run of a prepared statement Postgres may keep
 * one plan for any; and a turn among the two passes over a large table the
 * process runs at once, which a call of `list_chat_topics` used to take
 * beside them, uncounted.
 *
 * No date is bound, so the rule about a bound moment and a `timestamp`
 * column (docs/statistics.md) does not come up here.
 */
export function topicUsageQuery(scope: IAgentScopeCondition): Prisma.Sql {
  return Prisma.sql`
    SELECT r."topicId", COUNT(*)::int AS "conversations"
    FROM "ChatSession" s
    CROSS JOIN LATERAL (
      SELECT DISTINCT COALESCE(t."mergedIntoId", t."id") AS "topicId"
      FROM unnest(s."topicIds") AS u("id")
      JOIN "ChatTopic" t ON t."id" = u."id"
    ) r
    WHERE cardinality(s."topicIds") > 0
    ${agentCondition(scope)}
    GROUP BY r."topicId"
  `;
}

interface IUsageRow {
  topicId: string;
  conversations: number;
}

/** `labels` (Json) as the domain reads it: the entries that are strings. */
function labelsOf(value: Prisma.JsonValue): IChatTopicLabels {
  const labels: IChatTopicLabels = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return labels;
  }
  for (const [language, label] of Object.entries(value)) {
    if (typeof label === 'string') labels[language] = label;
  }
  return labels;
}

function toTopic(record: ChatTopic): IChatTopicData {
  return {
    id: record.id,
    key: record.key,
    labels: labelsOf(record.labels),
    mergedIntoId: record.mergedIntoId,
    createdAt: record.createdAt,
  };
}

@Injectable()
export class ChatTopicGateway extends IChatTopicGateway {
  constructor(private prisma: PrismaService) {
    super();
  }

  async usageCounts(
    agentScope?: IChatAgentScope,
  ): Promise<Map<string, number>> {
    const scope = agentScopeCondition(agentScope);
    // `IN ()` is not SQL, and no condition would count for every agent.
    if (!scope.matchesAny) return new Map();
    const rows = await runAggregate<IUsageRow>(
      this.prisma,
      topicUsageQuery(scope),
    );
    return new Map(rows.map((r) => [r.topicId, r.conversations]));
  }

  async vocabulary(
    cap: number,
    counts: ReadonlyMap<string, number>,
    always: ReadonlySet<string> = new Set(),
  ): Promise<IChatTopicData[]> {
    // The topics that stand, and no more of them than may stand
    // (`TOPICS_STANDING_MAX`). It was the whole table, which nothing kept
    // small: read for every conversation of a run, it grew with every topic
    // a conversation could talk the model into coining. Were there ever more
    // than the bound (a summary by hand beside the batch can coin one past
    // it), the oldest are the ones read: an order that does not depend on
    // how the rows happen to come back.
    //
    // The conversations are not read: how much each topic is used is the
    // caller's to know (`usageCounts`, once) and to keep.
    const records = await this.prisma.chatTopic.findMany({
      where: { mergedIntoId: null },
      orderBy: [{ createdAt: 'asc' }, { key: 'asc' }],
      take: TOPICS_STANDING_MAX,
    });
    return offeredTopics(topicUsage(records.map(toTopic), counts), cap, always);
  }

  standingByKey(key: string): Promise<IChatTopicData | null> {
    return this.standingFor(key);
  }

  countStanding(): Promise<number> {
    return this.prisma.chatTopic.count({ where: { mergedIntoId: null } });
  }

  async hasStanding(): Promise<boolean> {
    // One row and one column, `LIMIT 1`: the answer is "is there any", and
    // a count would read every standing topic to say it. The table is a row
    // per subject, a hundred standing at most (`TOPICS_STANDING_MAX`).
    const first = await this.prisma.chatTopic.findFirst({
      where: { mergedIntoId: null },
      select: { id: true },
    });
    return first !== null;
  }

  async findOrCreateByKey(
    key: string,
    labels: IChatTopicLabels,
  ): Promise<IChatTopicData> {
    const existing = await this.standingFor(key);
    if (existing) return existing;
    try {
      const created = await this.prisma.chatTopic.create({
        data: { id: `topic-${crypto.randomUUID()}`, key, labels },
      });
      return toTopic(created);
    } catch (err) {
      // The key appeared between the look and the insert: the batch is
      // sequential, but an on-demand summary can run beside it. The key is
      // unique, so the row that won is the topic.
      if ((err as { code?: string }).code !== 'P2002') throw err;
      const raced = await this.standingFor(key);
      if (!raced) throw err;
      return raced;
    }
  }

  async findByKey(key: string): Promise<IChatTopicData | null> {
    const record = await this.prisma.chatTopic.findUnique({ where: { key } });
    return record ? toTopic(record) : null;
  }

  async merge(fromId: string, intoId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // The two rows, locked until this transaction ends, and read as they
      // are once the lock is held. A merge that shares a topic with this
      // one waits here and then sees what this one wrote, or this one waits
      // and sees what that one wrote: whichever is second asks the rules of
      // the rows the first left. Without the lock both could pass the same
      // check and leave A → B → C. In id order, so that two merges of the
      // same two topics wait for each other in one direction and never in
      // a ring.
      const locked = await tx.$queryRaw<ChatTopic[]>(Prisma.sql`
        SELECT "id", "key", "labels", "mergedIntoId", "createdAt"
        FROM "ChatTopic"
        WHERE "id" IN (${fromId}, ${intoId})
        ORDER BY "id"
        FOR UPDATE`);
      const from = locked.find((record) => record.id === fromId);
      const into = locked.find((record) => record.id === intoId);
      if (!from || !into) {
        // Nothing deletes a topic today; a row removed by hand is the case.
        throw new ChatTopicMergeRefused(
          'One of the two topics no longer exists.',
        );
      }
      const refusal = topicMergeRefusal(toTopic(from), toTopic(into));
      if (refusal) throw new ChatTopicMergeRefused(refusal);

      // Both or neither: with only the second, a topic folded into
      // `fromId` earlier would point at a topic that is itself merged, and
      // its conversations would be counted under a topic no list shows.
      await tx.chatTopic.updateMany({
        where: { mergedIntoId: fromId },
        data: { mergedIntoId: intoId },
      });
      await tx.chatTopic.update({
        where: { id: fromId },
        data: { mergedIntoId: intoId },
      });
    });
  }

  async findByIds(
    ids: readonly string[],
  ): Promise<Map<string, IChatTopicData>> {
    const wanted = [...new Set(ids)];
    const found = new Map<string, IChatTopicData>();
    if (!wanted.length) return found;

    const records = await this.prisma.chatTopic.findMany({
      where: { id: { in: wanted } },
    });
    const targetIds = [
      ...new Set(
        records
          .map((r) => r.mergedIntoId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const targets = targetIds.length
      ? await this.prisma.chatTopic.findMany({
          where: { id: { in: targetIds } },
        })
      : [];
    const targetById = new Map(targets.map((t) => [t.id, t]));

    for (const record of records) {
      // Once, and no further. A target that is gone leaves the topic
      // standing for itself: its conversations still have a subject.
      const standing =
        (record.mergedIntoId && targetById.get(record.mergedIntoId)) || record;
      found.set(record.id, toTopic(standing));
    }
    return found;
  }

  async listWithCounts(
    agentScope?: IChatAgentScope,
  ): Promise<IChatTopicUsage[]> {
    const [records, counts] = await Promise.all([
      // The whole table: a row per subject people talk about, tens of them.
      this.prisma.chatTopic.findMany(),
      this.usageCounts(agentScope),
    ]);
    return topicUsage(records.map(toTopic), counts);
  }

  /**
   * The topic that stands for this key: the one that has it, or the one
   * that one was merged into.
   */
  private async standingFor(key: string): Promise<IChatTopicData | null> {
    const record = await this.prisma.chatTopic.findUnique({ where: { key } });
    if (!record) return null;
    if (record.mergedIntoId) {
      const target = await this.prisma.chatTopic.findUnique({
        where: { id: record.mergedIntoId },
      });
      if (target) return toTopic(target);
    }
    return toTopic(record);
  }
}
