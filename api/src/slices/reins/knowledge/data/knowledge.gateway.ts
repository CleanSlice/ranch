import { Injectable } from '@nestjs/common';
import { PrismaService } from '#/setup/prisma/prisma.service';
import { ILightragClient } from '../../lightrag/domain/lightrag.client';
import { IKnowledgeGateway } from '../domain/knowledge.gateway';
import {
  IKnowledgeData,
  ICreateKnowledgeData,
  IUpdateKnowledgeData,
  IIndexStatePatch,
  IKnowledgeQueryResult,
  QueryModeTypes,
  IGetGraphParams,
  IGraphData,
} from '../domain/knowledge.types';
import { workspaceOf } from '../../lightrag/data/workspace';
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

  async findById(id: string): Promise<IKnowledgeData | null> {
    const record = await this.prisma.knowledge.findUnique({ where: { id } });
    return record ? this.mapper.toEntity(record) : null;
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
        ...(data.entityTypes && { entityTypes: data.entityTypes }),
        ...(data.relationshipTypes && {
          relationshipTypes: data.relationshipTypes,
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

  async delete(id: string): Promise<void> {
    await this.prisma.knowledge.delete({ where: { id } });
  }

  async searchKnowledge(
    knowledgeId: string,
    query: string,
    mode?: QueryModeTypes,
    topK?: number,
  ): Promise<IKnowledgeQueryResult> {
    return this.lightrag.query({
      workspace: workspaceOf(knowledgeId),
      query,
      mode,
      topK,
    });
  }

  getGraphLabels(): Promise<string[]> {
    return this.lightrag.getGraphLabels();
  }

  getGraph(params: IGetGraphParams): Promise<IGraphData> {
    return this.lightrag.getGraph({
      label: params.label,
      maxDepth: params.maxDepth,
      maxNodes: params.maxNodes,
    });
  }
}
