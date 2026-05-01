import { BadRequestException, Injectable } from '@nestjs/common';
import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { ISettingGateway } from '#/setting/domain';
import {
  ISecretEntry,
  ISecretListData,
  SecretProviderTypes,
} from '../domain/secret.types';

const PROVIDER: SecretProviderTypes = 'file';

@Injectable()
export class FileSecretGateway {
  constructor(private settings: ISettingGateway) {}

  async list(agentId: string): Promise<ISecretListData> {
    const { client, bucket } = await this.connect();
    const prefix = `agents/${agentId}/data/secrets/`;

    const secrets: ISecretEntry[] = [];
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
        if (!obj.Key || !obj.Key.endsWith('.json')) continue;
        const userId = obj.Key.slice(prefix.length, -'.json'.length);
        if (!userId || userId.includes('/')) continue;

        const body = await client.send(
          new GetObjectCommand({ Bucket: bucket, Key: obj.Key }),
        );
        const text = (await body.Body?.transformToString('utf-8')) ?? '';
        const updatedAt = obj.LastModified ?? null;

        for (const entry of parseUserSecrets(text, userId, updatedAt)) {
          secrets.push(entry);
        }
      }
      continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (continuationToken);

    secrets.sort((a, b) => a.name.localeCompare(b.name));
    return { provider: PROVIDER, secrets };
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

function parseUserSecrets(
  text: string,
  userId: string,
  updatedAt: Date | null,
): ISecretEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  return Object.entries(parsed as Record<string, unknown>).map(
    ([key, value]) => ({
      name: `${userId}/${key}`,
      value: typeof value === 'string' ? value : JSON.stringify(value),
      updatedAt,
    }),
  );
}
