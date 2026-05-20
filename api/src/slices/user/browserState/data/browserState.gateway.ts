import { BadRequestException, Injectable } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { ISettingGateway } from '#/setting/domain';
import { IUserBrowserStateGateway } from '../domain/browserState.gateway';
import { IUserBrowserStatePayload } from '../domain/browserState.types';

@Injectable()
export class UserBrowserStateGateway extends IUserBrowserStateGateway {
  constructor(private settings: ISettingGateway) {
    super();
  }

  async get(
    userId: string,
    profile: string,
  ): Promise<IUserBrowserStatePayload | null> {
    const { client, bucket } = await this.connect();
    try {
      const res = await client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: this.objectKey(userId, profile),
        }),
      );
      const text = (await res.Body?.transformToString('utf-8')) ?? '';
      if (!text) return null;
      const parsed: unknown = JSON.parse(text);
      return this.normalize(parsed);
    } catch (err) {
      if (this.isNotFound(err)) return null;
      throw err;
    }
  }

  async set(
    userId: string,
    profile: string,
    payload: IUserBrowserStatePayload,
  ): Promise<void> {
    const { client, bucket } = await this.connect();
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: this.objectKey(userId, profile),
        Body: JSON.stringify(payload, null, 2),
        ContentType: 'application/json',
      }),
    );
  }

  async delete(userId: string, profile: string): Promise<void> {
    const { client, bucket } = await this.connect();
    try {
      await client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: this.objectKey(userId, profile),
        }),
      );
    } catch (err) {
      if (this.isNotFound(err)) return;
      throw err;
    }
  }

  /**
   * Same sanitization the runtime applies in playwright.repository.ts —
   * diverging means the runtime would look at a path that doesn't exist.
   * Keep these regexes in sync.
   */
  private objectKey(userId: string, profile: string): string {
    const safeUser = userId.replace(/[^a-zA-Z0-9_\-.]/g, '_');
    const safeProfile = profile.replace(/[^a-zA-Z0-9_:.\-]/g, '_');
    return `users/${safeUser}/browser-state/${safeProfile}.json`;
  }

  /**
   * Accept both the wrapped (`{userAgent, storageState}`) and the legacy
   * plain (`{cookies, origins}`) shapes for backwards-compat. Output is
   * always wrapped so callers don't have to branch.
   */
  private normalize(parsed: unknown): IUserBrowserStatePayload | null {
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, unknown>;
    if ('storageState' in obj) {
      const ss = obj.storageState as { cookies?: unknown; origins?: unknown };
      return {
        userAgent: typeof obj.userAgent === 'string' ? obj.userAgent : undefined,
        storageState: {
          cookies: Array.isArray(ss?.cookies)
            ? (ss.cookies as IUserBrowserStatePayload['storageState']['cookies'])
            : [],
          origins: Array.isArray(ss?.origins)
            ? (ss.origins as IUserBrowserStatePayload['storageState']['origins'])
            : [],
        },
      };
    }
    return {
      storageState: {
        cookies: Array.isArray(obj.cookies)
          ? (obj.cookies as IUserBrowserStatePayload['storageState']['cookies'])
          : [],
        origins: Array.isArray(obj.origins)
          ? (obj.origins as IUserBrowserStatePayload['storageState']['origins'])
          : [],
      },
    };
  }

  private isNotFound(err: unknown): boolean {
    const name = (err as { name?: string })?.name;
    return name === 'NoSuchKey' || name === 'NotFound';
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
