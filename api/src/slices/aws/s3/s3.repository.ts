import { BadRequestException, Injectable } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { ISettingGateway } from '#/setting/domain';
import {
  IS3FileLocation,
  IS3StoredFile,
  IS3UploadInput,
  S3RepositoryError,
} from './s3.types';

@Injectable()
export class S3Repository {
  private client: S3Client | undefined;

  constructor(private settings: ISettingGateway) {}

  async upload(input: IS3UploadInput): Promise<IS3StoredFile> {
    const client = await this.getClient();
    await client.send(
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
    const client = await this.getClient();
    const res = await client.send(
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
    const client = await this.getClient();
    await client.send(
      new DeleteObjectCommand({
        Bucket: location.bucket,
        Key: location.key,
      }),
    );
  }

  private async getClient(): Promise<S3Client> {
    if (this.client) return this.client;

    const get = async (name: string): Promise<string> => {
      const setting = await this.settings.findByKey('integrations', name);
      const value = setting?.value;
      return typeof value === 'string' ? value : '';
    };

    const [endpoint, region, accessKeyId, secretAccessKey] = await Promise.all([
      get('s3_endpoint'),
      get('s3_region'),
      get('s3_access_key'),
      get('s3_secret_key'),
    ]);

    if (!accessKeyId || !secretAccessKey) {
      throw new BadRequestException(
        'S3 is not configured (settings → integrations → s3_access_key, s3_secret_key)',
      );
    }

    this.client = new S3Client({
      endpoint: endpoint || undefined,
      region: region || 'us-east-1',
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: Boolean(endpoint),
    });
    return this.client;
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
    typeof value === 'object' && value !== null && Symbol.asyncIterator in value
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
