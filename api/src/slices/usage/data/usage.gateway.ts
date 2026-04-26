import { Injectable } from '@nestjs/common';
import { PrismaService } from '#/setup/prisma/prisma.service';
import { IUsageGateway } from '../domain/usage.gateway';
import { IUsageData, IReportUsageData } from '../domain/usage.types';
import { UsageMapper } from './usage.mapper';

function dayStartUtc(dateIso: string): Date {
  const d = new Date(dateIso);
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

@Injectable()
export class UsageGateway extends IUsageGateway {
  constructor(
    private prisma: PrismaService,
    private mapper: UsageMapper,
  ) {
    super();
  }

  async report(agentId: string, data: IReportUsageData): Promise<void> {
    const date = dayStartUtc(data.date);

    await this.prisma.$transaction(
      Object.entries(data.byModel).map(([model, entry]) =>
        this.prisma.usage.upsert({
          where: {
            agentId_model_date: { agentId, model, date },
          },
          create: this.mapper.toCreate({ agentId, model, date, entry }),
          update: this.mapper.toUpdate(entry),
        }),
      ),
    );
  }

  async findRecentForAgent(
    agentId: string,
    days: number,
  ): Promise<IUsageData[]> {
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - days);
    since.setUTCHours(0, 0, 0, 0);

    const records = await this.prisma.usage.findMany({
      where: { agentId, date: { gte: since } },
      orderBy: [{ date: 'desc' }, { model: 'asc' }],
    });
    return records.map((r) => this.mapper.toEntity(r));
  }
}
