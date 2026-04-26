import { Injectable } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  IS3Config,
  IS3FileLocation,
  IS3StoredFile,
  IS3UploadInput,
  S3RepositoryError,
} from './s3.types';

@Injectable()
export class S3Repository {
  private readonly client: S3Client;

  constructor(config: IS3Config) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: typeof config.endpoint === 'string',
    });
  }

  async upload(input: IS3UploadInput): Promise<IS3StoredFile> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: input.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
      }),
    );
    return {
      bucket: input.bucket,
      key: input.key,
      uri: S3Repository.toUri(input),
    };
  }

  async download(location: IS3FileLocation): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({
        Bucket: location.bucket,
        Key: location.key,
      }),
    );
    if (!res.Body) {
      throw new S3RepositoryError(
        'S3 download returned empty body',
        location.bucket,
        location.key,
      );
    }
    return streamToBuffer(res.Body, location);
  }

  async delete(location: IS3FileLocation): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: location.bucket,
        Key: location.key,
      }),
    );
  }

  static toUri(location: IS3FileLocation): string {
    return `s3://${location.bucket}/${location.key}`;
  }

  static parseUri(uri: string): IS3FileLocation {
    const match = /^s3:\/\/([^/]+)\/(.+)$/.exec(uri);
    if (!match) {
      throw new S3RepositoryError(`Invalid S3 URI: ${uri}`);
    }
    return { bucket: match[1], key: match[2] };
  }
}

function isAsyncIterableOfBytes(
  value: unknown,
): value is AsyncIterable<Uint8Array> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Symbol.asyncIterator in value
  );
}

async function streamToBuffer(
  body: unknown,
  location: IS3FileLocation,
): Promise<Buffer> {
  if (!isAsyncIterableOfBytes(body)) {
    throw new S3RepositoryError(
      'S3 download body is not an async iterable',
      location.bucket,
      location.key,
    );
  }
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    if (!(chunk instanceof Uint8Array)) {
      throw new S3RepositoryError(
        'S3 download stream emitted non-binary chunk',
        location.bucket,
        location.key,
      );
    }
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
