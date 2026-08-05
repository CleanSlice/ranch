import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '#/setup/prisma/prisma.service';
import { S3Repository } from '#/aws/s3';
import { IKnowledgeConfigGateway } from '../../config/domain/knowledgeConfig.gateway';
import { ILightragClient } from '../../lightrag/domain/lightrag.client';
import { workspaceOf } from '../../lightrag/data/workspace';
import { ISourceGateway } from '../domain/source.gateway';
import {
  ISourceData,
  ICreateSourceData,
  IUploadSourceFileInput,
  IUploadSourceStreamInput,
  IUploadedSourceFile,
} from '../domain/source.types';
import { SourceMapper } from './source.mapper';

@Injectable()
export class SourceGateway extends ISourceGateway {
  private readonly logger = new Logger(SourceGateway.name);
  private lastLoggedBucket = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly mapper: SourceMapper,
    private readonly lightrag: ILightragClient,
    private readonly s3: S3Repository,
    private readonly knowledgeConfig: IKnowledgeConfigGateway,
  ) {
    super();
  }

  /**
   * Keys live under a shared `knowledges/` prefix, mirroring the
   * `agents/{agent-id}` layout, so the knowledge bucket can be shared with
   * agent data without either scattering folders across the bucket root.
   */
  private static keyFor(knowledgeId: string, filename: string): string {
    return `knowledges/${knowledgeId}/${crypto.randomUUID()}-${filename}`;
  }

  private async requireBucket(): Promise<string> {
    const cfg = await this.knowledgeConfig.resolve();
    if (!cfg.bucket) {
      this.logger.error(
        'knowledge/s3_bucket is not set — cannot upload source files',
      );
      throw new ServiceUnavailableException(
        'Knowledge S3 bucket is not configured',
      );
    }
    // Only on change, so a busy import doesn't repeat one constant per file.
    // Worth logging at all because this bucket comes from knowledge/s3_bucket
    // while its region/endpoint come from the integrations/* group - the two
    // are edited on different settings pages and drift apart easily.
    if (cfg.bucket !== this.lastLoggedBucket) {
      this.logger.log(`knowledge sources bucket resolved: ${cfg.bucket}`);
      this.lastLoggedBucket = cfg.bucket;
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
    const knowledge = await this.prisma.knowledge.findUnique({
      where: { id: data.knowledgeId },
      select: { id: true },
    });
    if (!knowledge) {
      throw new NotFoundException(`Knowledge ${data.knowledgeId} not found`);
    }
    const record = await this.prisma.source.create({
      data: this.mapper.toCreate(data),
    });
    return this.mapper.toEntity(record);
  }

  /**
   * Bulk insert. Used by the sitemap importer where N sequential round
   * trips to a remote Postgres (Neon, us-east-1) would otherwise blow past
   * any reasonable HTTP timeout. All items must belong to the same
   * knowledge - the existence check runs once for that knowledge. The
   * caller only ever needs the count back, so we skip the re-fetch that a
   * full ISourceData[] would require.
   */
  async createMany(data: ICreateSourceData[]): Promise<ISourceData[]> {
    if (data.length === 0) return [];
    const knowledgeId = data[0].knowledgeId;
    if (!data.every((d) => d.knowledgeId === knowledgeId)) {
      throw new BadRequestException(
        'createMany requires all items to share the same knowledgeId',
      );
    }
    const knowledge = await this.prisma.knowledge.findUnique({
      where: { id: knowledgeId },
      select: { id: true },
    });
    if (!knowledge) {
      throw new NotFoundException(`Knowledge ${knowledgeId} not found`);
    }
    const rows = data.map((d) => this.mapper.toCreate(d));
    await this.prisma.source.createMany({ data: rows });
    return [];
  }

  async delete(id: string): Promise<void> {
    await this.prisma.source.delete({ where: { id } });
  }

  async uploadFile(
    input: IUploadSourceFileInput,
  ): Promise<IUploadedSourceFile> {
    const bucket = await this.requireBucket();
    const key = SourceGateway.keyFor(input.knowledgeId, input.filename);
    const stored = await this.s3.upload({
      bucket,
      key,
      body: input.body,
      contentType: input.contentType,
    });
    return { url: stored.uri };
  }

  async uploadFileStream(
    input: IUploadSourceStreamInput,
  ): Promise<IUploadedSourceFile> {
    const bucket = await this.requireBucket();
    const key = SourceGateway.keyFor(input.knowledgeId, input.filename);
    // S3Repository uploads buffers via PutObject; the custom/MinIO endpoint
    // doesn't accept unbounded streaming bodies. Archive entries are
    // processed one at a time, so materializing a single entry keeps peak
    // memory bounded to that one file - the same profile as uploadFile.
    const chunks: Buffer[] = [];
    for await (const chunk of input.body) {
      if (!(chunk instanceof Uint8Array)) {
        throw new BadRequestException(
          'archive entry stream emitted a non-binary chunk',
        );
      }
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const stored = await this.s3.upload({
      bucket,
      key,
      body: Buffer.concat(chunks),
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
