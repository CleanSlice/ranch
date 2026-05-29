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

    // Resolve which referenced credentials actually exist. Stale ids
    // (credential deleted, cross-env import, mistyped string) would
    // otherwise blow up the whole batch with
    // `Foreign key constraint violated on Usage_llmCredentialId_fkey`.
    // Usage is best-effort telemetry — drop the credential link rather
    // than reject the report.
    const referenced = new Set<string>();
    for (const entry of Object.values(data.byModel)) {
      if (entry.llmCredentialId) referenced.add(entry.llmCredentialId);
    }
    const valid =
      referenced.size === 0
        ? new Set<string>()
        : new Set(
            (
              await this.prisma.llmCredential.findMany({
                where: { id: { in: [...referenced] } },
                select: { id: true },
              })
            ).map((c) => c.id),
          );

    await this.prisma.$transaction(
      Object.entries(data.byModel).map(([model, entry]) => {
        const safeEntry = {
          ...entry,
          llmCredentialId:
            entry.llmCredentialId && valid.has(entry.llmCredentialId)
              ? entry.llmCredentialId
              : undefined,
        };
        return this.prisma.usage.upsert({
          where: {
            agentId_model_date: { agentId, model, date },
          },
          create: this.mapper.toCreate({
            agentId,
            model,
            date,
            entry: safeEntry,
          }),
          update: this.mapper.toUpdate(safeEntry),
        });
      }),
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

  async findRecentForCredential(
    credentialId: string,
    days: number,
  ): Promise<IUsageData[]> {
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - days);
    since.setUTCHours(0, 0, 0, 0);

    const records = await this.prisma.usage.findMany({
      where: { llmCredentialId: credentialId, date: { gte: since } },
      orderBy: [{ date: 'desc' }, { model: 'asc' }],
    });
    return records.map((r) => this.mapper.toEntity(r));
  }
}
