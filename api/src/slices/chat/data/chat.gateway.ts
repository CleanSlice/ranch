import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '#/setup/prisma/prisma.service';
import {
  IChatGateway,
  IChatFilter,
  IChatListResult,
  IChatReconcileInput,
  IChatSessionData,
} from '../domain';
import { ChatMapper } from './chat.mapper';

const DEFAULT_PER_PAGE = 50;

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
      where: { agentId_sessionKey: { agentId: input.agentId, sessionKey: input.sessionKey } },
    });

    const record = existing
      ? await this.prisma.chatSession.update({
          where: { id: existing.id },
          data: this.mapper.toReconcileUpdate(input, existing),
        })
      : await this.prisma.chatSession.create({ data: this.mapper.toCreate(input) });

    return this.mapper.toEntity(record);
  }

  private buildWhere(filter: IChatFilter): Prisma.ChatSessionWhereInput {
    const where: Prisma.ChatSessionWhereInput = {};
    if (filter.agentId) where.agentId = filter.agentId;

    if (filter.channel) where.channel = filter.channel;
    else if (!filter.includeInternal) where.channel = { not: 'internal' };

    if (filter.archived !== undefined) where.archived = filter.archived;

    if (filter.search) {
      where.OR = [
        { title: { contains: filter.search, mode: 'insensitive' } },
        { preview: { contains: filter.search, mode: 'insensitive' } },
        { externalUserId: { contains: filter.search, mode: 'insensitive' } },
      ];
    }
    return where;
  }
}
