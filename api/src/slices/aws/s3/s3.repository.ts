import { Injectable, Logger } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  GetObjectCommandOutput,
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
  private readonly logger = new Logger(S3Repository.name);
  private client: S3Client | undefined;
  private configSummary = '(client not built)';

  constructor(private settings: ISettingGateway) {}

  async upload(input: IS3UploadInput): Promise<IS3StoredFile> {
    const client = await this.getClient();
    const started = Date.now();
    this.logger.log(
      `upload → s3://${input.bucket}/${input.key} ` +
        `(${input.body.length} bytes, ${input.contentType})`,
    );
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: input.bucket,
          Key: input.key,
          Body: input.body,
          ContentType: input.contentType,
        }),
      );
    } catch (err) {
      this.fail('upload', input, err);
    }
    this.logger.log(
      `upload ok s3://${input.bucket}/${input.key} in ${Date.now() - started}ms`,
    );
    return {
      bucket: input.bucket,
      key: input.key,
      uri: S3Repository.toUri(input),
    };
  }

  async download(location: IS3FileLocation): Promise<Buffer> {
    const client = await this.getClient();
    this.logger.log(`download → s3://${location.bucket}/${location.key}`);
    let res: GetObjectCommandOutput;
    try {
      res = await client.send(
        new GetObjectCommand({
          Bucket: location.bucket,
          Key: location.key,
        }),
      );
    } catch (err) {
      this.fail('download', location, err);
    }
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
    this.logger.log(`delete → s3://${location.bucket}/${location.key}`);
    try {
      await client.send(
        new DeleteObjectCommand({
          Bucket: location.bucket,
          Key: location.key,
        }),
      );
    } catch (err) {
      this.fail('delete', location, err);
    }
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
      get('aws_region'),
      get('aws_access_key_id'),
      get('aws_secret_access_key'),
    ]);

    // Remembered so a failure can name the endpoint/region it actually used -
    // without it an S3 301 surfaces as a bare 500 with no way to tell which
    // setting is wrong.
    this.configSummary =
      `region=${region || 'us-east-1 (default)'} ` +
      `endpoint=${endpoint || 'aws-default'} ` +
      `credentials=${accessKeyId && secretAccessKey ? 'static' : 'provider-chain'}`;

    // Logged once per process (the client is cached below), so a pod's logs
    // always start with the storage config it will use for its whole life.
    // Key values are never logged - only whether they resolved.
    this.logger.log(
      `building S3 client: ${this.configSummary} ` +
        `pathStyle=${endpoint ? 'true' : 'false'} followRegionRedirects=true` +
        (region
          ? ''
          : ' — WARNING: integrations/aws_region is empty, falling back to' +
            ' us-east-1; a bucket in another region will 301 until the SDK' +
            ' redirect kicks in'),
    );

    // Credentials optional — when both are present we use them explicitly
    // (static keys / MinIO); when blank we omit `credentials` so the SDK
    // default provider chain (IRSA / Pod Identity on EKS) supplies them.
    this.client = new S3Client({
      region: region || 'us-east-1',
      // Buckets are configured per feature (agent data, knowledge sources)
      // but share this one region setting, so a bucket in another region is
      // normal rather than a misconfiguration. On a 301 the SDK retries
      // against the region S3 reports in `x-amz-bucket-region` instead of
      // failing with "must be addressed using the specified endpoint".
      followRegionRedirects: true,
      ...(accessKeyId && secretAccessKey
        ? { credentials: { accessKeyId, secretAccessKey } }
        : {}),
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    });
    return this.client;
  }

  /**
   * Rethrow with the bucket, key and resolved client config attached. S3's
   * own messages ("The bucket you are attempting to access must be addressed
   * using the specified endpoint") say nothing about which of the several
   * configured buckets or which region setting produced them.
   */
  private fail(
    operation: string,
    location: IS3FileLocation,
    err: unknown,
  ): never {
    const reason = err instanceof Error ? err.message : String(err);
    const aws = describeAwsError(err);
    const message =
      `S3 ${operation} failed for s3://${location.bucket}/${location.key} ` +
      `[${this.configSummary}]${aws ? ` [${aws}]` : ''}: ${reason}`;

    // Logged as well as thrown: the HTTP layer shows the caller one line,
    // while the pod log keeps the stack and the AWS response detail.
    this.logger.error(message, err instanceof Error ? err.stack : undefined);
    throw new S3RepositoryError(message, location.bucket, location.key);
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

/**
 * Pull the parts of an AWS SDK error that identify a misconfiguration.
 * The decisive one is `x-amz-bucket-region`: on a 301 PermanentRedirect S3
 * reports the region the bucket really lives in, which is exactly the value
 * `integrations/aws_region` should hold. Returns '' for non-AWS errors.
 */
function describeAwsError(err: unknown): string {
  if (!err || typeof err !== 'object') return '';
  const e = err as {
    name?: string;
    $metadata?: { httpStatusCode?: number; requestId?: string };
    $response?: { headers?: Record<string, string> };
  };

  const parts: string[] = [];
  if (typeof e.name === 'string' && e.name !== 'Error') {
    parts.push(`awsError=${e.name}`);
  }
  if (typeof e.$metadata?.httpStatusCode === 'number') {
    parts.push(`httpStatus=${e.$metadata.httpStatusCode}`);
  }
  const bucketRegion = e.$response?.headers?.['x-amz-bucket-region'];
  if (bucketRegion) {
    parts.push(
      `actualBucketRegion=${bucketRegion} <- set integrations/aws_region to this`,
    );
  }
  if (e.$metadata?.requestId) parts.push(`requestId=${e.$metadata.requestId}`);
  return parts.join(' ');
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
