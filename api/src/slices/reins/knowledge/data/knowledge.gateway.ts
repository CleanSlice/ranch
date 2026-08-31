import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '#/setup/prisma/prisma.service';
import { ILightragClient } from '../../lightrag/domain/lightrag.client';
import { IKnowledgeGateway } from '../domain/knowledge.gateway';
import {
  IKnowledgeData,
  ICreateKnowledgeData,
  IUpdateKnowledgeData,
  IFilterKnowledgeParams,
  IKnowledgePage,
  IIndexStatePatch,
  IInstanceStatePatch,
  IRawKnowledgeSearchResult,
  MigrationStateTypes,
  QueryModeTypes,
  IGetGraphParams,
  IGraphData,
} from '../domain/knowledge.types';
import { workspaceOf } from '../../lightrag/data/workspace';
import { deriveIndexStatus } from '../domain/knowledge.status';
import type { SourceIndexStateTypes } from '../../source/domain/source.types';
import { KnowledgeMapper } from './knowledge.mapper';

@Injectable()
export class KnowledgeGateway extends IKnowledgeGateway {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mapper: KnowledgeMapper,
    private readonly lightrag: ILightragClient,
  ) {
    super();
  }

  async findAll(): Promise<IKnowledgeData[]> {
    const records = await this.prisma.knowledge.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return records.map((r) => this.mapper.toEntity(r));
  }

  async findPage(params: IFilterKnowledgeParams): Promise<IKnowledgePage> {
    const page = Math.max(params.page ?? 1, 1);
    const perPage = Math.min(Math.max(params.perPage ?? 50, 1), 100);
    const search = params.search?.trim();
    // "By content" means a base is findable through what it holds — source
    // names count as content for search purposes (FR-009, US2 scenario 1).
    const where: Prisma.KnowledgeWhereInput = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
            {
              sources: {
                some: { name: { contains: search, mode: 'insensitive' } },
              },
            },
          ],
        }
      : {};

    const [records, total] = await this.prisma.$transaction([
      this.prisma.knowledge.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
        include: { _count: { select: { sources: true } } },
      }),
      this.prisma.knowledge.count({ where }),
    ]);

    const ids = records.map((r) => r.id);
    const sums = ids.length
      ? await this.prisma.source.groupBy({
          by: ['knowledgeId'],
          where: { knowledgeId: { in: ids } },
          _sum: { sizeBytes: true },
        })
      : [];
    const sizeOf = new Map(
      sums.map((s) => [s.knowledgeId, s._sum.sizeBytes ?? 0]),
    );

    const stateRows = ids.length
      ? await this.prisma.source.groupBy({
          by: ['knowledgeId', 'indexState'],
          where: { knowledgeId: { in: ids } },
          _count: { _all: true },
        })
      : [];
    const statesOf = new Map<string, SourceIndexStateTypes[]>();
    for (const row of stateRows) {
      const list = statesOf.get(row.knowledgeId) ?? [];
      const state = row.indexState as SourceIndexStateTypes;
      for (let i = 0; i < row._count._all; i += 1) list.push(state);
      statesOf.set(row.knowledgeId, list);
    }

    return {
      items: records.map((r) => ({
        ...this.mapper.toEntity(r),
        indexStatus: deriveIndexStatus(statesOf.get(r.id) ?? []),
        sourcesCount: r._count.sources,
        totalSizeBytes: sizeOf.get(r.id) ?? 0,
      })),
      total,
      page,
      perPage,
    };
  }

  async findById(id: string): Promise<IKnowledgeData | null> {
    const record = await this.prisma.knowledge.findUnique({ where: { id } });
    return record ? this.mapper.toEntity(record) : null;
  }

  async findExistingByIds(ids: string[]): Promise<IKnowledgeData[]> {
    if (ids.length === 0) return [];
    const records = await this.prisma.knowledge.findMany({
      where: { id: { in: ids } },
    });
    return records.map((r) => this.mapper.toEntity(r));
  }

  async create(data: ICreateKnowledgeData): Promise<IKnowledgeData> {
    const created = await this.prisma.$transaction(async (tx) => {
      const initial = await tx.knowledge.create({
        data: this.mapper.toCreate(data),
      });
      return tx.knowledge.update({
        where: { id: initial.id },
        data: { workspace: workspaceOf(initial.id) },
      });
    });
    return this.mapper.toEntity(created);
  }

  async update(
    id: string,
    data: IUpdateKnowledgeData,
  ): Promise<IKnowledgeData> {
    const record = await this.prisma.knowledge.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && {
          description: data.description,
        }),
      },
    });
    return this.mapper.toEntity(record);
  }

  async updateIndexState(
    id: string,
    patch: IIndexStatePatch,
  ): Promise<IKnowledgeData> {
    const record = await this.prisma.knowledge.update({
      where: { id },
      data: {
        indexStatus: patch.indexStatus,
        ...(patch.indexError !== undefined && { indexError: patch.indexError }),
        ...(patch.indexedAt !== undefined && { indexedAt: patch.indexedAt }),
        ...(patch.indexStartedAt !== undefined && {
          indexStartedAt: patch.indexStartedAt,
        }),
      },
    });
    return this.mapper.toEntity(record);
  }

  async updateInstanceState(
    id: string,
    patch: IInstanceStatePatch,
  ): Promise<IKnowledgeData> {
    const record = await this.prisma.knowledge.update({
      where: { id },
      data: {
        instanceState: patch.instanceState,
        ...(patch.instanceError !== undefined && {
          instanceError: patch.instanceError,
        }),
        ...(patch.instanceEndpoint !== undefined && {
          instanceEndpoint: patch.instanceEndpoint,
        }),
      },
    });
    return this.mapper.toEntity(record);
  }

  async updateMigrationState(
    id: string,
    state: MigrationStateTypes,
  ): Promise<IKnowledgeData> {
    const record = await this.prisma.knowledge.update({
      where: { id },
      data: { migrationState: state },
    });
    return this.mapper.toEntity(record);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.knowledge.delete({ where: { id } });
  }

  async searchKnowledge(
    knowledgeId: string,
    query: string,
    mode?: QueryModeTypes,
    topK?: number,
  ): Promise<IRawKnowledgeSearchResult> {
    return this.lightrag.query({
      knowledgeId,
      query,
      mode,
      topK,
    });
  }

  getGraphLabels(knowledgeId: string): Promise<string[]> {
    return this.lightrag.getGraphLabels(knowledgeId);
  }

  getGraph(knowledgeId: string, params: IGetGraphParams): Promise<IGraphData> {
    return this.lightrag.getGraph({
      knowledgeId,
      label: params.label,
      maxDepth: params.maxDepth,
      maxNodes: params.maxNodes,
    });
  }
}
