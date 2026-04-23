import { Injectable, Logger } from '@nestjs/common';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { IFileLoader } from '../domain/reins.service';

export interface MinioConfig {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

@Injectable()
export class MinioFileLoader implements IFileLoader {
  private readonly logger = new Logger(MinioFileLoader.name);
  private readonly client: S3Client;
  readonly bucket: string;
  readonly endpoint: string;

  constructor(config: MinioConfig) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: true,
    });
    this.bucket = config.bucket;
    this.endpoint = config.endpoint;
  }

  async upload(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    return `s3://${this.bucket}/${key}`;
  }

  async loadFile(url: string): Promise<Buffer> {
    const key = this.keyFromUrl(url);
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!res.Body) throw new Error(`MinIO: empty body for ${url}`);
    const chunks: Buffer[] = [];
    for await (const chunk of res.Body as AsyncIterable<Buffer>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  async delete(url: string): Promise<void> {
    const key = this.keyFromUrl(url);
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    } catch (err) {
      this.logger.warn(
        `MinIO delete failed for ${url}: ${(err as Error).message}`,
      );
    }
  }

  private keyFromUrl(url: string): string {
    const prefix = `s3://${this.bucket}/`;
    if (!url.startsWith(prefix)) {
      throw new Error(`MinIO: unexpected url shape ${url}`);
    }
    return url.slice(prefix.length);
  }
}
