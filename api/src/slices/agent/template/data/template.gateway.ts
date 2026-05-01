import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { PrismaService } from '#/setup/prisma/prisma.service';
import { ISettingGateway } from '#/setting/domain';
import { ITemplateGateway } from '../domain/template.gateway';
import {
  ITemplateData,
  ICreateTemplateData,
  IUpdateTemplateData,
} from '../domain/template.types';
import { TemplateMapper } from './template.mapper';

@Injectable()
export class TemplateGateway extends ITemplateGateway {
  private readonly logger = new Logger(TemplateGateway.name);

  constructor(
    private prisma: PrismaService,
    private mapper: TemplateMapper,
    private settings: ISettingGateway,
  ) {
    super();
  }

  async findAll(): Promise<ITemplateData[]> {
    const records = await this.prisma.template.findMany({
      orderBy: { name: 'asc' },
    });
    return records.map((r) => this.mapper.toEntity(r));
  }

  async findById(id: string): Promise<ITemplateData | null> {
    const record = await this.prisma.template.findUnique({ where: { id } });
    return record ? this.mapper.toEntity(record) : null;
  }

  async create(data: ICreateTemplateData): Promise<ITemplateData> {
    const record = await this.prisma.template.create({
      data: this.mapper.toCreate(data),
    });
    return this.mapper.toEntity(record);
  }

  async update(id: string, data: IUpdateTemplateData): Promise<ITemplateData> {
    const record = await this.prisma.template.update({
      where: { id },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.description && { description: data.description }),
        ...(data.image && { image: data.image }),
        ...(data.defaultConfig && {
          defaultConfig: data.defaultConfig as unknown as Prisma.InputJsonValue,
        }),
        ...(data.defaultResources && {
          defaultResources:
            data.defaultResources as unknown as Prisma.InputJsonValue,
        }),
        ...(data.defaultKnowledgeIds !== undefined && {
          defaultKnowledgeIds: data.defaultKnowledgeIds,
        }),
      },
    });
    return this.mapper.toEntity(record);
  }

  async touch(id: string): Promise<ITemplateData> {
    const record = await this.prisma.template.update({
      where: { id },
      data: { updatedAt: new Date() },
    });
    return this.mapper.toEntity(record);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.template.delete({ where: { id } });
    try {
      await this.wipeS3Prefix(`templates/${id}/`);
    } catch (err) {
      this.logger.warn(
        `S3 cleanup failed for template ${id}: ${(err as Error).message}`,
      );
    }
  }

  private async wipeS3Prefix(prefix: string): Promise<void> {
    const conn = await this.tryConnectS3();
    if (!conn) return;
    const { client, bucket } = conn;

    let continuationToken: string | undefined;
    do {
      const list = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      const keys = (list.Contents ?? [])
        .map((o) => o.Key)
        .filter((k): k is string => Boolean(k));
      if (keys.length > 0) {
        await client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
          }),
        );
      }
      continuationToken = list.IsTruncated
        ? list.NextContinuationToken
        : undefined;
    } while (continuationToken);
  }

  private async tryConnectS3(): Promise<{
    client: S3Client;
    bucket: string;
  } | null> {
    const get = async (name: string): Promise<string> => {
      const setting = await this.settings.findByKey('integrations', name);
      const value = setting?.value;
      return typeof value === 'string' ? value : '';
    };
    const [bucket, region, accessKeyId, secretAccessKey, endpoint] =
      await Promise.all([
        get('s3_bucket'),
        get('aws_region'),
        get('aws_access_key_id'),
        get('aws_secret_access_key'),
        get('s3_endpoint'),
      ]);
    if (!bucket || !accessKeyId || !secretAccessKey) return null;

    const client = new S3Client({
      region: region || 'us-east-1',
      credentials: { accessKeyId, secretAccessKey },
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    });
    return { client, bucket };
  }
}
