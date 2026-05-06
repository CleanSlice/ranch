import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '#/setup/prisma/prisma.service';
import {
  IPaddockEvaluationGateway,
  IFindPaddockEvaluationsFilter,
  ICreatePaddockEvaluationRecord,
} from '../domain/evaluation.gateway';
import {
  IPaddockEvaluationData,
  IPaddockEvaluationResultData,
  IUpdatePaddockEvaluationData,
} from '../domain/evaluation.types';
import { PaddockEvaluationMapper } from './evaluation.mapper';

@Injectable()
export class PaddockEvaluationGateway extends IPaddockEvaluationGateway {
  constructor(
    private prisma: PrismaService,
    private mapper: PaddockEvaluationMapper,
  ) {
    super();
  }

  async findAll(
    filter?: IFindPaddockEvaluationsFilter,
  ): Promise<IPaddockEvaluationData[]> {
    const where: Prisma.PaddockEvaluationWhereInput = {};
    if (filter?.agentId !== undefined) where.agentId = filter.agentId;
    if (filter?.templateId !== undefined) where.templateId = filter.templateId;

    const records = await this.prisma.paddockEvaluation.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      take: filter?.limit ?? 50,
      include: { results: true },
    });
    return records.map((r) => this.mapper.toEntity(r));
  }

  async findById(id: string): Promise<IPaddockEvaluationData | null> {
    const record = await this.prisma.paddockEvaluation.findUnique({
      where: { id },
      include: { results: true },
    });
    return record ? this.mapper.toEntity(record) : null;
  }

  async create(
    data: ICreatePaddockEvaluationRecord,
  ): Promise<IPaddockEvaluationData> {
    const record = await this.prisma.paddockEvaluation.create({
      data: this.mapper.toCreate(data),
      include: { results: true },
    });
    return this.mapper.toEntity(record);
  }

  async update(
    id: string,
    data: IUpdatePaddockEvaluationData,
  ): Promise<IPaddockEvaluationData> {
    const record = await this.prisma.paddockEvaluation.update({
      where: { id },
      data: {
        ...(data.status && { status: data.status }),
        ...(data.finishedAt !== undefined && { finishedAt: data.finishedAt }),
        ...(data.currentScenarioId !== undefined && {
          currentScenarioId: data.currentScenarioId,
        }),
        ...(data.passRate !== undefined && { passRate: data.passRate }),
        ...(data.scenarioCount !== undefined && {
          scenarioCount: data.scenarioCount,
        }),
        ...(data.passCount !== undefined && { passCount: data.passCount }),
        ...(data.failCount !== undefined && { failCount: data.failCount }),
        ...(data.partialCount !== undefined && {
          partialCount: data.partialCount,
        }),
        ...(data.skippedCount !== undefined && {
          skippedCount: data.skippedCount,
        }),
        ...(data.reportS3Key !== undefined && {
          reportS3Key: data.reportS3Key,
        }),
        ...(data.errorMessage !== undefined && {
          errorMessage: data.errorMessage,
        }),
      },
      include: { results: true },
    });
    return this.mapper.toEntity(record);
  }

  async addResults(
    id: string,
    results: Omit<IPaddockEvaluationResultData, 'id' | 'evaluationId'>[],
  ): Promise<void> {
    if (results.length === 0) return;
    await this.prisma.paddockEvaluationResult.createMany({
      data: results.map((r) => this.mapper.toResultCreate(id, r)),
    });
  }

  async findRunning(agentId: string): Promise<IPaddockEvaluationData | null> {
    const record = await this.prisma.paddockEvaluation.findFirst({
      where: { agentId, status: 'running' },
      include: { results: true },
    });
    return record ? this.mapper.toEntity(record) : null;
  }
}
