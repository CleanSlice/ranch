import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectsCommand,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { ISettingGateway } from '#/setting/domain';
import { ITemplateFileGateway } from '../domain/templateFile.gateway';
import {
  ITemplateFileContent,
  ITemplateFileNode,
  ITemplateFileUpload,
} from '../domain/templateFile.types';

const MAX_BYTES = 256 * 1024;
const ALLOWED_WRITE_EXT = new Set(['.md', '.json']);

@Injectable()
export class S3TemplateFileGateway extends ITemplateFileGateway {
  constructor(private settings: ISettingGateway) {
    super();
  }

  async list(templateId: string): Promise<ITemplateFileNode[]> {
    const { client, bucket } = await this.connect();
    const prefix = this.prefix(templateId);

    const out: ITemplateFileNode[] = [];
    let continuationToken: string | undefined;

    do {
      const res = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      for (const obj of res.Contents ?? []) {
        if (!obj.Key) continue;
        out.push({
          path: obj.Key.slice(prefix.length),
          size: obj.Size ?? 0,
          updatedAt: obj.LastModified ?? new Date(0),
        });
      }
      continuationToken = res.IsTruncated
        ? res.NextContinuationToken
        : undefined;
    } while (continuationToken);

    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  async read(templateId: string, path: string): Promise<ITemplateFileContent> {
    this.assertSafePath(path);
    const { client, bucket } = await this.connect();
    const key = this.prefix(templateId) + path;

    let head;
    try {
      head = await client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: key }),
      );
    } catch (err) {
      if (this.isNotFound(err)) throw new NotFoundException('File not found');
      throw err;
    }

    const size = head.ContentLength ?? 0;
    if (size > MAX_BYTES) {
      throw new BadRequestException(
        `File too large to view (${size} > ${MAX_BYTES} bytes)`,
      );
    }

    const res = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    const content = (await res.Body?.transformToString('utf-8')) ?? '';

    return {
      path,
      content,
      size,
      updatedAt: head.LastModified ?? new Date(0),
    };
  }

  async save(templateId: string, path: string, content: string): Promise<void> {
    this.assertSafePath(path);
    this.assertWritableExt(path);

    const bytes = Buffer.byteLength(content, 'utf-8');
    if (bytes > MAX_BYTES) {
      throw new BadRequestException(
        `File too large to save (${bytes} > ${MAX_BYTES} bytes)`,
      );
    }

    if (path.endsWith('.json')) {
      try {
        JSON.parse(content);
      } catch (err) {
        throw new BadRequestException(
          `Invalid JSON: ${(err as Error).message}`,
        );
      }
    }

    const { client, bucket } = await this.connect();
    const key = this.prefix(templateId) + path;

    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: content,
        ContentType: this.contentType(path),
      }),
    );
  }

  async uploadMany(
    templateId: string,
    files: ITemplateFileUpload[],
  ): Promise<void> {
    const { client, bucket } = await this.connect();
    const prefix = this.prefix(templateId);

    for (const file of files) {
      this.assertSafePath(file.path);
      if (file.buffer.byteLength > MAX_BYTES) {
        throw new BadRequestException(
          `File ${file.path} too large (${file.buffer.byteLength} > ${MAX_BYTES} bytes)`,
        );
      }
    }

    for (const file of files) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: prefix + file.path,
          Body: file.buffer,
          ContentType: file.contentType ?? this.contentType(file.path),
        }),
      );
    }
  }

  async wipe(templateId: string): Promise<void> {
    const { client, bucket } = await this.connect();
    const prefix = this.prefix(templateId);

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

  private prefix(templateId: string): string {
    return `templates/${templateId}/`;
  }

  private assertSafePath(path: string): void {
    if (!path) throw new BadRequestException('Path is required');
    if (path.startsWith('/'))
      throw new BadRequestException('Path must be relative');
    if (path.includes('\0')) throw new BadRequestException('Invalid path');
    const segments = path.split('/');
    if (segments.some((s) => s === '..' || s === '.')) {
      throw new BadRequestException('Path traversal not allowed');
    }
  }

  private assertWritableExt(path: string): void {
    const dot = path.lastIndexOf('.');
    const ext = dot >= 0 ? path.slice(dot).toLowerCase() : '';
    if (!ALLOWED_WRITE_EXT.has(ext)) {
      throw new BadRequestException(
        `Only ${[...ALLOWED_WRITE_EXT].join(', ')} files can be edited`,
      );
    }
  }

  private contentType(path: string): string {
    if (path.endsWith('.json')) return 'application/json; charset=utf-8';
    if (path.endsWith('.md')) return 'text/markdown; charset=utf-8';
    if (path.endsWith('.yaml') || path.endsWith('.yml'))
      return 'application/yaml; charset=utf-8';
    if (path.endsWith('.txt')) return 'text/plain; charset=utf-8';
    return 'application/octet-stream';
  }

  private isNotFound(err: unknown): boolean {
    if (err instanceof S3ServiceException) {
      return err.name === 'NotFound' || err.name === 'NoSuchKey';
    }
    return false;
  }

  private async connect(): Promise<{ client: S3Client; bucket: string }> {
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

    if (!bucket) {
      throw new BadRequestException(
        'S3 bucket is not configured (settings → integrations → s3_bucket)',
      );
    }
    if (!accessKeyId || !secretAccessKey) {
      throw new BadRequestException(
        'AWS credentials are not configured (settings → integrations)',
      );
    }

    const client = new S3Client({
      region: region || 'us-east-1',
      credentials: { accessKeyId, secretAccessKey },
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    });

    return { client, bucket };
  }
}
