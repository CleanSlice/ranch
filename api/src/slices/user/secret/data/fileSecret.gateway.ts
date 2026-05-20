import { BadRequestException, Injectable } from '@nestjs/common';
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { ISettingGateway } from '#/setting/domain';
import {
  IUserSecretEntry,
  IUserSecretListData,
  UserSecretProviderTypes,
} from '../domain/secret.types';

const PROVIDER: UserSecretProviderTypes = 'file';

/**
 * Per-user S3 file gateway. One JSON blob per user at
 * `users/<userId>/secrets/integrations.json`. Distinct top-level prefix
 * from agent/secret's `agents/<agentId>/data/secrets/<scope>.json` so
 * scope boundaries are visible at the bucket level.
 */
@Injectable()
export class FileUserSecretGateway {
  constructor(private settings: ISettingGateway) {}

  async list(userId: string): Promise<IUserSecretListData> {
    const { client, bucket } = await this.connect();
    const objectKey = this.objectKey(userId);

    try {
      const res = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: objectKey }),
      );
      const text = (await res.Body?.transformToString('utf-8')) ?? '';
      const updatedAt = res.LastModified ?? null;
      return {
        provider: PROVIDER,
        secrets: parseSecretJson(text, updatedAt),
      };
    } catch (err) {
      if (this.isNotFound(err)) return { provider: PROVIDER, secrets: [] };
      throw err;
    }
  }

  async get(userId: string, key: string): Promise<string | null> {
    const { client, bucket } = await this.connect();
    const store = await this.loadFile(client, bucket, this.objectKey(userId));
    return store[key] ?? null;
  }

  async set(userId: string, key: string, value: string): Promise<void> {
    const { client, bucket } = await this.connect();
    const objectKey = this.objectKey(userId);
    const store = await this.loadFile(client, bucket, objectKey);
    store[key] = value;
    await this.saveFile(client, bucket, objectKey, store);
  }

  async delete(userId: string, key: string): Promise<void> {
    const { client, bucket } = await this.connect();
    const objectKey = this.objectKey(userId);
    const store = await this.loadFile(client, bucket, objectKey);
    if (!(key in store)) return;
    delete store[key];
    await this.saveFile(client, bucket, objectKey, store);
  }

  private objectKey(userId: string): string {
    return `users/${userId}/secrets/integrations.json`;
  }

  private async loadFile(
    client: S3Client,
    bucket: string,
    objectKey: string,
  ): Promise<Record<string, string>> {
    try {
      const res = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: objectKey }),
      );
      const text = (await res.Body?.transformToString('utf-8')) ?? '';
      const parsed: unknown = text ? JSON.parse(text) : {};
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {};
      }
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        out[k] = typeof v === 'string' ? v : JSON.stringify(v);
      }
      return out;
    } catch (err) {
      if (this.isNotFound(err)) return {};
      throw err;
    }
  }

  private async saveFile(
    client: S3Client,
    bucket: string,
    objectKey: string,
    store: Record<string, string>,
  ): Promise<void> {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: objectKey,
        Body: JSON.stringify(store, null, 2),
        ContentType: 'application/json',
      }),
    );
  }

  private isNotFound(err: unknown): boolean {
    return (err as { name?: string })?.name === 'NoSuchKey';
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

function parseSecretJson(
  text: string,
  updatedAt: Date | null,
): IUserSecretEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  return Object.entries(parsed as Record<string, unknown>)
    .map(([name, value]) => ({
      name,
      value: typeof value === 'string' ? value : JSON.stringify(value),
      updatedAt,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
