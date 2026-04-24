import { Injectable } from '@nestjs/common';
import { PrismaService } from '#/setup/prisma/prisma.service';
import { IReinsGateway } from '../domain/reins.gateway';
import {
  IKnowledgeData,
  ICreateKnowledgeData,
  IUpdateKnowledgeData,
  IReinsSourceData,
  ICreateSourceData,
  IndexStatusTypes,
} from '../domain/reins.types';
import { ReinsMapper } from './reins.mapper';

function workspaceOf(id: string): string {
  return `knowledge_${id.replace(/-/g, '')}`;
}

@Injectable()
export class ReinsGateway extends IReinsGateway {
  constructor(
    private prisma: PrismaService,
    private mapper: ReinsMapper,
  ) {
    super();
  }

  async findAllKnowledge(): Promise<IKnowledgeData[]> {
    const records = await this.prisma.knowledge.findMany({
      include: { sources: true },
      orderBy: { createdAt: 'desc' },
    });
    return records.map((r) => this.mapper.toKnowledgeEntity(r));
  }

  async findKnowledgeById(id: string): Promise<IKnowledgeData | null> {
    const record = await this.prisma.knowledge.findUnique({
      where: { id },
      include: { sources: true },
    });
    return record ? this.mapper.toKnowledgeEntity(record) : null;
  }

  async createKnowledge(data: ICreateKnowledgeData): Promise<IKnowledgeData> {
    const record = await this.prisma.$transaction(async (tx) => {
      const created = await tx.knowledge.create({
        data: {
          name: data.name,
          description: data.description ?? null,
          entityTypes: data.entityTypes ?? [],
          relationshipTypes: data.relationshipTypes ?? [],
          workspace: 'pending',
        },
      });
      return tx.knowledge.update({
        where: { id: created.id },
        data: { workspace: workspaceOf(created.id) },
        include: { sources: true },
      });
    });
    return this.mapper.toKnowledgeEntity(record);
  }

  async updateKnowledge(
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
      include: { sources: true },
    });
    return this.mapper.toKnowledgeEntity(record);
  }

  async updateKnowledgeIndexState(
    id: string,
    patch: {
      indexStatus: IndexStatusTypes;
      indexError?: string | null;
      indexedAt?: Date | null;
      indexStartedAt?: Date | null;
    },
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
      include: { sources: true },
    });
    return this.mapper.toKnowledgeEntity(record);
  }

  async deleteKnowledge(id: string): Promise<void> {
    await this.prisma.knowledge.delete({ where: { id } });
  }

  async findSourcesByKnowledge(
    knowledgeId: string,
  ): Promise<IReinsSourceData[]> {
    const records = await this.prisma.reinsSource.findMany({
      where: { knowledgeId },
      orderBy: { createdAt: 'asc' },
    });
    return records.map((r) => this.mapper.toSourceEntity(r));
  }

  async findSourceById(id: string): Promise<IReinsSourceData | null> {
    const record = await this.prisma.reinsSource.findUnique({ where: { id } });
    return record ? this.mapper.toSourceEntity(record) : null;
  }

  async createSource(data: ICreateSourceData): Promise<IReinsSourceData> {
    const record = await this.prisma.reinsSource.create({
      data: {
        knowledgeId: data.knowledgeId,
        type: data.type,
        name: data.name,
        url: data.url ?? null,
        mimeType: data.mimeType ?? null,
        content: data.content ?? null,
        sizeBytes: data.sizeBytes ?? null,
      },
    });
    return this.mapper.toSourceEntity(record);
  }

  async setSourceLightragDocId(
    id: string,
    lightragDocId: string,
  ): Promise<IReinsSourceData> {
    const record = await this.prisma.reinsSource.update({
      where: { id },
      data: { lightragDocId },
    });
    return this.mapper.toSourceEntity(record);
  }

  async deleteSource(id: string): Promise<void> {
    await this.prisma.reinsSource.delete({ where: { id } });
  }
}
