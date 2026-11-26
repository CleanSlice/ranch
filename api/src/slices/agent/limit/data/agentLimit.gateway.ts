import { Injectable } from '@nestjs/common';
import { PrismaService } from '#/setup/prisma/prisma.service';
import {
  IAgentLimitGateway,
  IAgentLimitRow,
  IAgentLimits,
  IAgentLoadMinute,
  WINDOW_MS,
} from '../domain';
import { IAgentLoadDay } from '../domain/agentLimit.gateway';
import { dayDeltas, utcDayOf } from '../domain/loadDay';

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
    const minuteWrites = minutes.map((m) => {
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
    });
    // The same counts again, by UTC day (CLEAN-261): the minute rows go after
    // 30 days and these are what a longer period reads.
    const dayWrites = dayDeltas(minutes).map((d) => {
      const day = new Date(d.day);
      return this.prisma.agentLoadDay.upsert({
        where: { agentId_day: { agentId, day } },
        create: {
          agentId,
          day,
          accepted: d.accepted,
          refused: d.refused,
          exempt: d.exempt,
        },
        update: {
          accepted: { increment: d.accepted },
          refused: { increment: d.refused },
          exempt: { increment: d.exempt },
        },
      });
    });
    // One transaction: a flush that fails halfway is retried as a whole, and
    // retrying a half-written one would count those minutes twice. The days
    // are in it for the same reason: written apart, a retry would add to a
    // day what its minutes got once.
    await this.prisma.$transaction([...minuteWrites, ...dayWrites]);
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

  async rebuildMissingDays(sinceDay: Date): Promise<number> {
    const today = utcDayOf(Date.now());
    let written = 0;
    // One grouped query per day: prisma cannot group by the day of a
    // timestamp, and reading a month of minute rows to add them up here would
    // be the heavier way. At most a month of days is asked for, once a boot.
    for (
      let day = utcDayOf(sinceDay.getTime());
      day <= today;
      day += WINDOW_MS.day
    ) {
      const sums = await this.prisma.agentLoadMinute.groupBy({
        by: ['agentId'],
        where: {
          minute: { gte: new Date(day), lt: new Date(day + WINDOW_MS.day) },
        },
        _sum: { accepted: true, refused: true, exempt: true },
      });
      if (sums.length === 0) continue;
      const { count } = await this.prisma.agentLoadDay.createMany({
        data: sums.map((s) => ({
          agentId: s.agentId,
          day: new Date(day),
          accepted: s._sum.accepted ?? 0,
          refused: s._sum.refused ?? 0,
          exempt: s._sum.exempt ?? 0,
        })),
        // A day that has a row was counted as it happened and stays as it
        // is. Left to the database, so there is no read-then-write to race.
        skipDuplicates: true,
      });
      written += count;
    }
    return written;
  }

  async pruneDaysBefore(date: Date): Promise<void> {
    await this.prisma.agentLoadDay.deleteMany({
      where: { day: { lt: date } },
    });
  }

  async findDays(
    agentIds: string[],
    from: Date,
    to: Date,
  ): Promise<IAgentLoadDay[]> {
    if (agentIds.length === 0) return [];
    const rows = await this.prisma.agentLoadDay.findMany({
      where: { agentId: { in: agentIds }, day: { gte: from, lt: to } },
      orderBy: [{ day: 'asc' }, { agentId: 'asc' }],
    });
    return rows.map((r) => ({
      agentId: r.agentId,
      day: r.day,
      accepted: r.accepted,
      refused: r.refused,
      exempt: r.exempt,
    }));
  }

  async firstDayAt(): Promise<Date | null> {
    const first = await this.prisma.agentLoadDay.findFirst({
      orderBy: { day: 'asc' },
      select: { day: true },
    });
    return first?.day ?? null;
  }
}
