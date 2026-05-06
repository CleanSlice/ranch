import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '#/setup/prisma/prisma.service';
import {
  IPaddockScenarioGateway,
  IFindPaddockScenariosFilter,
} from '../domain/scenario.gateway';
import {
  IPaddockScenarioData,
  ICreatePaddockScenarioData,
  IUpdatePaddockScenarioData,
} from '../domain/scenario.types';
import { PaddockScenarioMapper } from './scenario.mapper';

@Injectable()
export class PaddockScenarioGateway extends IPaddockScenarioGateway {
  constructor(
    private prisma: PrismaService,
    private mapper: PaddockScenarioMapper,
  ) {
    super();
  }

  async findAll(
    filter?: IFindPaddockScenariosFilter,
  ): Promise<IPaddockScenarioData[]> {
    const where: Prisma.PaddockScenarioWhereInput = {};
    if (filter?.templateId !== undefined) where.templateId = filter.templateId;
    if (filter?.agentId !== undefined) where.agentId = filter.agentId;

    const records = await this.prisma.paddockScenario.findMany({
      where,
      orderBy: { createdAt: 'asc' },
    });
    return records.map((r) => this.mapper.toEntity(r));
  }

  async findById(id: string): Promise<IPaddockScenarioData | null> {
    const record = await this.prisma.paddockScenario.findUnique({
      where: { id },
    });
    return record ? this.mapper.toEntity(record) : null;
  }

  // Returns the merged set: agent-overrides take precedence over template-level
  // scenarios with the same name. Order: agent-specific first, then templates.
  async findForAgent(agentId: string): Promise<IPaddockScenarioData[]> {
    const agent = await this.prisma.agent.findUnique({
      where: { id: agentId },
      select: { templateId: true },
    });

    const records = await this.prisma.paddockScenario.findMany({
      where: {
        OR: [
          { agentId },
          ...(agent ? [{ templateId: agent.templateId, agentId: null }] : []),
        ],
      },
      orderBy: [{ agentId: 'desc' }, { createdAt: 'asc' }],
    });

    const seen = new Set<string>();
    const merged: IPaddockScenarioData[] = [];
    for (const r of records) {
      const entity = this.mapper.toEntity(r);
      if (seen.has(entity.name)) continue;
      seen.add(entity.name);
      merged.push(entity);
    }
    return merged;
  }

  async create(
    data: ICreatePaddockScenarioData,
  ): Promise<IPaddockScenarioData> {
    const record = await this.prisma.paddockScenario.create({
      data: this.mapper.toCreate(data),
    });
    return this.mapper.toEntity(record);
  }

  async update(
    id: string,
    data: IUpdatePaddockScenarioData,
  ): Promise<IPaddockScenarioData> {
    const record = await this.prisma.paddockScenario.update({
      where: { id },
      data: {
        ...(data.category && { category: data.category }),
        ...(data.difficulty && { difficulty: data.difficulty }),
        ...(data.name && { name: data.name }),
        ...(data.description !== undefined && {
          description: data.description,
        }),
        ...(data.expectedBehavior !== undefined && {
          expectedBehavior: data.expectedBehavior,
        }),
        ...(data.messages && {
          messages: data.messages as unknown as Prisma.InputJsonValue,
        }),
        ...(data.successCriteria && {
          successCriteria:
            data.successCriteria as unknown as Prisma.InputJsonValue,
        }),
        ...(data.setup !== undefined && {
          setup: (data.setup ?? null) as unknown as Prisma.InputJsonValue,
        }),
      },
    });
    return this.mapper.toEntity(record);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.paddockScenario.delete({ where: { id } });
  }
}
