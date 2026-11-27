import { Injectable } from '@nestjs/common';
import { ChatMessageSource } from '@prisma/client';
import { PrismaService } from '#/setup/prisma/prisma.service';
import {
  IChatSourceGateway,
  ICitationGroup,
  ICitationRange,
  ICitedAnswer,
  ICreateChatMessageSource,
  IChatMessageSourceData,
} from '../domain';

@Injectable()
export class ChatSourceGateway extends IChatSourceGateway {
  constructor(private prisma: PrismaService) {
    super();
  }

  async upsertMany(rows: ICreateChatMessageSource[]): Promise<void> {
    if (rows.length === 0) return;
    const { messageId, agentId, clientId } = rows[0];
    // One transaction per event: a half-written list would show a bubble
    // whose chips outnumber its entries. The ownership check sits inside it:
    // a message id belongs to one conversation, and a runtime replaying an
    // id it does not own may not rewrite what another reader was shown.
    await this.prisma.$transaction(async (tx) => {
      const foreign = await tx.chatMessageSource.findFirst({
        where: {
          messageId,
          OR: [{ agentId: { not: agentId } }, { clientId: { not: clientId } }],
        },
        select: { id: true },
      });
      if (foreign) {
        throw new Error(
          `message ${messageId} belongs to another conversation; its sources stay as they are`,
        );
      }
      for (const r of rows) {
        await tx.chatMessageSource.upsert({
          where: { messageId_n: { messageId: r.messageId, n: r.n } },
          create: r,
          update: {
            kind: r.kind,
            sourceId: r.sourceId,
            knowledgeId: r.knowledgeId,
            knowledgeName: r.knowledgeName,
            name: r.name,
            url: r.url,
          },
        });
      }
    });
  }

  async findByMessageIds(
    messageIds: string[],
  ): Promise<IChatMessageSourceData[]> {
    if (messageIds.length === 0) return [];
    const records = await this.prisma.chatMessageSource.findMany({
      where: { messageId: { in: messageIds } },
      orderBy: [{ messageId: 'asc' }, { n: 'asc' }],
    });
    return records.map(toEntity);
  }

  async findOne(
    agentId: string,
    messageId: string,
    n: number,
  ): Promise<IChatMessageSourceData | null> {
    const record = await this.prisma.chatMessageSource.findUnique({
      where: { messageId_n: { messageId, n } },
    });
    // The unique key is the message's; the agent id is checked, not queried,
    // so a route cannot read another agent's citation by guessing ids.
    return record && record.agentId === agentId ? toEntity(record) : null;
  }

  async findCitedAnswers(range: ICitationRange): Promise<ICitedAnswer[]> {
    // One group per answer, however many sources it cited: the rows of one
    // bubble share its message id (and its agent, which `upsertMany` holds
    // them to).
    const groups = await this.prisma.chatMessageSource.groupBy({
      by: ['agentId', 'messageId'],
      where: rangeWhere(range),
      _min: { createdAt: true },
    });
    const answers: ICitedAnswer[] = [];
    for (const group of groups) {
      // A group is at least one row, so it has a first one; the type says
      // "or null" because an aggregate over nothing has none.
      const at = group._min.createdAt;
      if (at) {
        answers.push({
          agentId: group.agentId,
          messageId: group.messageId,
          at,
        });
      }
    }
    return answers.sort((a, b) => a.at.getTime() - b.at.getTime());
  }

  async countCitationsBySource(
    range: ICitationRange,
  ): Promise<ICitationGroup[]> {
    const groups = await this.prisma.chatMessageSource.groupBy({
      by: ['kind', 'knowledgeId', 'knowledgeName'],
      where: rangeWhere(range),
      _count: { _all: true },
      _max: { createdAt: true },
    });
    const counted: ICitationGroup[] = [];
    for (const group of groups) {
      const lastCitedAt = group._max.createdAt;
      if (!lastCitedAt) continue;
      counted.push({
        kind: group.kind === 'web' ? 'web' : 'knowledge',
        knowledgeId: group.knowledgeId,
        knowledgeName: group.knowledgeName,
        citations: group._count._all,
        lastCitedAt,
      });
    }
    return counted;
  }

  async firstCreatedAt(): Promise<Date | null> {
    // No index leads with `createdAt`, so this reads the table once. It is
    // asked once in an installation's life, at the boot that first sees the
    // citations figure (FigureRegistry), not when a page is viewed.
    const found = await this.prisma.chatMessageSource.aggregate({
      _min: { createdAt: true },
    });
    return found._min.createdAt;
  }
}

/**
 * One person's citations in a range: an equality and a range, which is the
 * index on [clientId, createdAt], and the agents the person reaches when
 * their lists hide some.
 */
function rangeWhere(range: ICitationRange) {
  return {
    clientId: range.clientId,
    createdAt: { gte: range.from, lte: range.to },
    ...(range.agentScope ? { agentId: range.agentScope } : {}),
  };
}

function toEntity(r: ChatMessageSource): IChatMessageSourceData {
  return {
    id: r.id,
    agentId: r.agentId,
    clientId: r.clientId,
    sessionKey: r.sessionKey,
    messageId: r.messageId,
    n: r.n,
    kind: r.kind === 'web' ? 'web' : 'knowledge',
    sourceId: r.sourceId,
    knowledgeId: r.knowledgeId,
    knowledgeName: r.knowledgeName,
    name: r.name,
    url: r.url,
    createdAt: r.createdAt,
  };
}
