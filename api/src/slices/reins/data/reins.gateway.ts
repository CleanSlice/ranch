import { Injectable } from '@nestjs/common';
import { PrismaService } from '#/setup/prisma/prisma.service';
import { S3Repository } from '#/aws/s3';
import { IReinsGateway } from '../domain/reins.gateway';
import {
  IKnowledgeData,
  ICreateKnowledgeData,
  IUpdateKnowledgeData,
  IReinsSourceData,
  ICreateSourceData,
  IIndexStatePatch,
  IKnowledgeQueryResult,
  IUploadSourceFileInput,
  IUploadedSourceFile,
  QueryModeTypes,
  IGetGraphParams,
  IGraphData,
} from '../domain/reins.types';
import { ReinsMapper } from './reins.mapper';
import { ILightragClient } from './repositories/lightrag/lightrag.client';

function workspaceOf(id: string): string {
  return `knowledge_${id.replace(/-/g, '')}`;
}

@Injectable()
export class ReinsGateway extends IReinsGateway {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mapper: ReinsMapper,
    private readonly lightrag: ILightragClient,
    private readonly s3: S3Repository,
    private readonly bucket: string,
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

  async deleteSource(id: string): Promise<void> {
    await this.prisma.reinsSource.delete({ where: { id } });
  }

  async uploadSourceFile(
    input: IUploadSourceFileInput,
  ): Promise<IUploadedSourceFile> {
    const key = `${input.knowledgeId}/${crypto.randomUUID()}-${input.filename}`;
    const stored = await this.s3.upload({
      bucket: this.bucket,
      key,
      body: input.body,
      contentType: input.contentType,
    });
    return { url: stored.uri };
  }

  async deleteSourceFile(url: string): Promise<void> {
    const location = S3Repository.parseUri(url);
    await this.s3.delete(location);
  }

  async indexSource(source: IReinsSourceData): Promise<void> {
    const workspace = await this.workspaceOfKnowledge(source.knowledgeId);
    const docId = await this.ingestByType(source, workspace);
    await this.prisma.reinsSource.update({
      where: { id: source.id },
      data: { lightragDocId: docId },
    });
  }

  async removeSourceFromIndex(source: IReinsSourceData): Promise<void> {
    const record = await this.prisma.reinsSource.findUnique({
      where: { id: source.id },
      select: { lightragDocId: true },
    });
    if (!record?.lightragDocId) return;
    await this.lightrag.deleteDocumentsByTrackIds([record.lightragDocId]);
  }

  async removeKnowledgeFromIndex(knowledgeId: string): Promise<void> {
    const records = await this.prisma.reinsSource.findMany({
      where: { knowledgeId, lightragDocId: { not: null } },
      select: { lightragDocId: true },
    });
    const trackIds = records
      .map((r) => r.lightragDocId)
      .filter((v): v is string => v !== null);
    if (trackIds.length === 0) return;
    await this.lightrag.deleteDocumentsByTrackIds(trackIds);
  }

  async searchKnowledge(
    knowledgeId: string,
    query: string,
    mode?: QueryModeTypes,
    topK?: number,
  ): Promise<IKnowledgeQueryResult> {
    const workspace = await this.workspaceOfKnowledge(knowledgeId);
    return this.lightrag.query({ workspace, query, mode, topK });
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

  private async ingestByType(
    source: IReinsSourceData,
    workspace: string,
  ): Promise<string> {
    if (source.type === 'text') {
      if (!source.content) {
        throw new Error(`Source ${source.id} has no content`);
      }
      const res = await this.lightrag.ingestText({
        workspace,
        text: source.content,
        fileSource: source.name,
      });
      return res.docId;
    }
    if (source.type === 'url') {
      if (!source.url) {
        throw new Error(`Source ${source.id} has no url`);
      }
      const res = await this.lightrag.ingestUrl({
        workspace,
        url: source.url,
      });
      return res.docId;
    }
    if (source.type === 'file') {
      if (!source.url) {
        throw new Error(`Source ${source.id} has no url`);
      }
      const location = S3Repository.parseUri(source.url);
      const buffer = await this.s3.download(location);
      const res = await this.lightrag.ingestFile({
        workspace,
        filename: source.name,
        mimeType: source.mimeType ?? 'application/octet-stream',
        content: buffer,
      });
      return res.docId;
    }
    const exhaustive: never = source.type;
    throw new Error(`Unknown source type: ${String(exhaustive)}`);
  }

  private async workspaceOfKnowledge(knowledgeId: string): Promise<string> {
    const record = await this.prisma.knowledge.findUnique({
      where: { id: knowledgeId },
      select: { workspace: true },
    });
    return record?.workspace ?? workspaceOf(knowledgeId);
  }
}
