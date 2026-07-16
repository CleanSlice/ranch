import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '#/setup/prisma/prisma.service';
import {
  IChatGateway,
  IChatActivity,
  IChatFilter,
  IChatInsightGate,
  IChatInsights,
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

  async recordActivity(agentId: string, a: IChatActivity): Promise<void> {
    // Atomic increment in the DB — no read-modify-write, so concurrent events
    // for the same session can't lose an increment. The NOT-filter dedups a
    // redelivered event (eventId watermark).
    if (await this.incrementActivity(agentId, a)) return;

    // No row matched: either a brand-new session, or a duplicate event on an
    // existing one. Try to create; a unique violation means the row now exists
    // (created by a concurrent event, or it's the dup) — re-run the increment,
    // which applies for a real event and no-ops for a dup.
    try {
      await this.prisma.chatSession.create({
        data: this.mapper.toActivityCreate(agentId, a),
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        await this.incrementActivity(agentId, a);
      } else {
        throw err;
      }
    }
  }

  private async incrementActivity(
    agentId: string,
    a: IChatActivity,
  ): Promise<boolean> {
    const res = await this.prisma.chatSession.updateMany({
      where: {
        agentId,
        sessionKey: a.sessionKey,
        NOT: { lastIndexedEventId: a.eventId },
      },
      data: {
        messageCount: { increment: 1 },
        ...(a.role === 'user' ? { userMessageCount: { increment: 1 } } : {}),
        lastMessageAt: new Date(a.ts),
        preview: a.preview,
        lastRole: a.role,
        lastIndexedEventId: a.eventId,
      },
    });
    return res.count > 0;
  }

  async findEligibleForInsight(
    gate: IChatInsightGate,
  ): Promise<IChatSessionData[]> {
    const settledBefore = new Date(Date.now() - gate.cooldownMs);
    const records = await this.prisma.chatSession.findMany({
      where: {
        channel: { not: 'internal' },
        archived: false,
        userMessageCount: { gte: gate.minUserMessages },
        lastMessageAt: { lt: settledBefore },
        // New activity since the last summary (null = never summarized).
        OR: [
          { summaryAt: null },
          { lastMessageAt: { gt: this.prisma.chatSession.fields.summaryAt } },
        ],
      },
      orderBy: { lastMessageAt: 'desc' },
      take: gate.limit,
    });
    return records.map((r) => this.mapper.toEntity(r));
  }

  async saveInsights(
    id: string,
    summary: string,
    insights: IChatInsights,
  ): Promise<void> {
    await this.prisma.chatSession.update({
      where: { id },
      data: {
        summary,
        insights: insights as unknown as Prisma.InputJsonValue,
        summaryAt: new Date(),
      },
    });
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
