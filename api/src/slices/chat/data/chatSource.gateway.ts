import { Injectable } from '@nestjs/common';
import { ChatMessageSource } from '@prisma/client';
import { PrismaService } from '#/setup/prisma/prisma.service';
import {
  IChatSourceGateway,
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
