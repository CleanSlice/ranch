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
  DeleteObjectCommand,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { ISettingGateway } from '#/setting/domain';
import { IFileGateway } from '../domain/file.gateway';
import { IFileContent, IFileNode } from '../domain/file.types';

const MAX_BYTES = 256 * 1024;
const ALLOWED_WRITE_EXT = new Set(['.md', '.json']);

@Injectable()
export class S3FileGateway extends IFileGateway {
  constructor(private settings: ISettingGateway) {
    super();
  }

  async list(agentId: string): Promise<IFileNode[]> {
    const { client, bucket } = await this.connect();
    const prefix = this.prefix(agentId);

    const out: IFileNode[] = [];
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

  async read(agentId: string, path: string): Promise<IFileContent> {
    this.assertSafePath(path);
    const { client, bucket } = await this.connect();
    const key = this.prefix(agentId) + path;

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

  async save(agentId: string, path: string, content: string): Promise<void> {
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
    const key = this.prefix(agentId) + path;

    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: content,
        ContentType: this.contentType(path),
      }),
    );
  }

  async delete(agentId: string, path: string): Promise<void> {
    this.assertSafePath(path);
    const { client, bucket } = await this.connect();
    const key = this.prefix(agentId) + path;

    try {
      await client.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: key }),
      );
    } catch (err) {
      // S3 DELETE is idempotent — 404 isn't typically returned, but treat
      // any not-found as success so callers (e.g. "reset chat") don't fail
      // when the file already doesn't exist.
      if (this.isNotFound(err)) return;
      throw err;
    }
  }

  private prefix(agentId: string): string {
    return `agents/${agentId}/`;
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
    return 'text/plain; charset=utf-8';
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
