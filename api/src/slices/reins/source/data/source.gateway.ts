import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '#/setup/prisma/prisma.service';
import { S3Repository } from '#/aws/s3';
import { IKnowledgeConfigService } from '../../config/domain/knowledgeConfig.service';
import { ILightragClient } from '../../lightrag/domain/lightrag.client';
import { workspaceOf } from '../../knowledge/domain/workspace';
import { ISourceGateway } from '../domain/source.gateway';
import {
  ISourceData,
  ICreateSourceData,
  IUploadSourceFileInput,
  IUploadedSourceFile,
} from '../domain/source.types';
import { SourceMapper } from './source.mapper';

@Injectable()
export class SourceGateway extends ISourceGateway {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mapper: SourceMapper,
    private readonly lightrag: ILightragClient,
    private readonly s3: S3Repository,
    private readonly knowledgeConfig: IKnowledgeConfigService,
  ) {
    super();
  }

  private async requireBucket(): Promise<string> {
    const cfg = await this.knowledgeConfig.resolve();
    if (!cfg.bucket) {
      throw new ServiceUnavailableException(
        'Knowledge S3 bucket is not configured',
      );
    }
    return cfg.bucket;
  }

  async findByKnowledgeId(knowledgeId: string): Promise<ISourceData[]> {
    const records = await this.prisma.source.findMany({
      where: { knowledgeId },
      orderBy: { createdAt: 'asc' },
    });
    return records.map((r) => this.mapper.toEntity(r));
  }

  async findById(id: string): Promise<ISourceData | null> {
    const record = await this.prisma.source.findUnique({ where: { id } });
    return record ? this.mapper.toEntity(record) : null;
  }

  async create(data: ICreateSourceData): Promise<ISourceData> {
    const record = await this.prisma.source.create({
      data: this.mapper.toCreate(data),
    });
    return this.mapper.toEntity(record);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.source.delete({ where: { id } });
  }

  async uploadFile(
    input: IUploadSourceFileInput,
  ): Promise<IUploadedSourceFile> {
    const bucket = await this.requireBucket();
    const key = `${input.knowledgeId}/${crypto.randomUUID()}-${input.filename}`;
    const stored = await this.s3.upload({
      bucket,
      key,
      body: input.body,
      contentType: input.contentType,
    });
    return { url: stored.uri };
  }

  async deleteFile(url: string): Promise<void> {
    const location = S3Repository.parseUri(url);
    await this.s3.delete(location);
  }

  async indexSource(source: ISourceData): Promise<void> {
    const workspace = workspaceOf(source.knowledgeId);
    const docId = await this.ingestByType(source, workspace);
    await this.prisma.source.update({
      where: { id: source.id },
      data: { lightragDocId: docId },
    });
  }

  async removeFromIndex(source: ISourceData): Promise<void> {
    const record = await this.prisma.source.findUnique({
      where: { id: source.id },
      select: { lightragDocId: true },
    });
    if (!record?.lightragDocId) return;
    await this.lightrag.deleteDocumentsByTrackIds([record.lightragDocId]);
  }

  async removeAllByKnowledge(knowledgeId: string): Promise<void> {
    const records = await this.prisma.source.findMany({
      where: { knowledgeId, lightragDocId: { not: null } },
      select: { lightragDocId: true },
    });
    const trackIds = records
      .map((r) => r.lightragDocId)
      .filter((v): v is string => v !== null);
    if (trackIds.length === 0) return;
    await this.lightrag.deleteDocumentsByTrackIds(trackIds);
  }

  private async ingestByType(
    source: ISourceData,
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
}
