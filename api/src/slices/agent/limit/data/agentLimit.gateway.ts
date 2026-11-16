import { Injectable } from '@nestjs/common';
import { PrismaService } from '#/setup/prisma/prisma.service';
import {
  IAgentLimitGateway,
  IAgentLimitRow,
  IAgentLimits,
  IAgentLoadMinute,
} from '../domain';

@Injectable()
export class AgentLimitGateway extends IAgentLimitGateway {
  constructor(private prisma: PrismaService) {
    super();
  }

  async findAll(): Promise<IAgentLimitRow[]> {
    const rows = await this.prisma.agentLimit.findMany();
    return rows.map((r) => ({
      agentId: r.agentId,
      limits: {
        perMinute: r.perMinute,
        perHour: r.perHour,
        perDay: r.perDay,
      },
    }));
  }

  async upsert(
    agentId: string,
    limits: IAgentLimits,
    userId: string | null,
  ): Promise<void> {
    const data = { ...limits, updatedById: userId };
    await this.prisma.agentLimit.upsert({
      where: { agentId },
      create: { agentId, ...data },
      update: data,
    });
  }

  async remove(agentId: string): Promise<void> {
    // deleteMany, not delete: "limits off" for an agent that had none is not
    // an error.
    await this.prisma.agentLimit.deleteMany({ where: { agentId } });
  }

  async addMinutes(
    agentId: string,
    minutes: IAgentLoadMinute[],
  ): Promise<void> {
    if (minutes.length === 0) return;
    // One transaction: a flush that fails halfway is retried as a whole, and
    // retrying a half-written one would count those minutes twice.
    await this.prisma.$transaction(
      minutes.map((m) => {
        const minute = new Date(m.minute);
        return this.prisma.agentLoadMinute.upsert({
          where: { agentId_minute: { agentId, minute } },
          create: {
            agentId,
            minute,
            accepted: m.accepted,
            refused: m.refused,
            refusedByMinute: m.refusedByMinute,
            refusedByHour: m.refusedByHour,
            refusedByDay: m.refusedByDay,
            exempt: m.exempt,
          },
          update: {
            accepted: { increment: m.accepted },
            refused: { increment: m.refused },
            refusedByMinute: { increment: m.refusedByMinute },
            refusedByHour: { increment: m.refusedByHour },
            refusedByDay: { increment: m.refusedByDay },
            exempt: { increment: m.exempt },
          },
        });
      }),
    );
  }

  async minutes(agentId: string, sinceMs: number): Promise<IAgentLoadMinute[]> {
    const rows = await this.prisma.agentLoadMinute.findMany({
      where: { agentId, minute: { gte: new Date(sinceMs) } },
      orderBy: { minute: 'asc' },
    });
    return rows.map((r) => ({
      minute: r.minute.getTime(),
      accepted: r.accepted,
      refused: r.refused,
      refusedByMinute: r.refusedByMinute,
      refusedByHour: r.refusedByHour,
      refusedByDay: r.refusedByDay,
      exempt: r.exempt,
    }));
  }

  async pruneBefore(beforeMs: number): Promise<void> {
    await this.prisma.agentLoadMinute.deleteMany({
      where: { minute: { lt: new Date(beforeMs) } },
    });
  }
}
