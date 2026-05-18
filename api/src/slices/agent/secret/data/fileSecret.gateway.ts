import { BadRequestException, Injectable } from '@nestjs/common';
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
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
      continuationToken = res.IsTruncated
        ? res.NextContinuationToken
        : undefined;
    } while (continuationToken);

    secrets.sort((a, b) => a.name.localeCompare(b.name));
    return { provider: PROVIDER, secrets };
  }

  async set(agentId: string, key: string, value: string): Promise<void> {
    const { client, bucket } = await this.connect();
    const { scope, realKey } = splitName(key, agentId);
    const objectKey = `agents/${agentId}/data/secrets/${scope}.json`;
    const store = await this.loadFile(client, bucket, objectKey);
    store[realKey] = value;
    await this.saveFile(client, bucket, objectKey, store);
  }

  async delete(agentId: string, key: string): Promise<void> {
    const { client, bucket } = await this.connect();
    const { scope, realKey } = splitName(key, agentId);
    const objectKey = `agents/${agentId}/data/secrets/${scope}.json`;
    const store = await this.loadFile(client, bucket, objectKey);
    if (!(realKey in store)) return;
    delete store[realKey];
    await this.saveFile(client, bucket, objectKey, store);
  }

  // Atomic full replace writes to the canonical per-agent file. Any legacy
  // multi-scope files are left untouched (and will keep showing up in list()
  // until the user clears them manually) — JSON-mode editing is meant for the
  // AWS provider, which has no scope concept.
  async replaceAll(
    agentId: string,
    store: Record<string, string>,
  ): Promise<void> {
    const { client, bucket } = await this.connect();
    const objectKey = `agents/${agentId}/data/secrets/${agentId}.json`;
    await this.saveFile(client, bucket, objectKey, store);
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
      if ((err as { name?: string })?.name === 'NoSuchKey') return {};
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

// `list()` exposes entries as "<scope>/<key>". On write we reverse that: a
// name with a slash targets that scope's file, a bare key is a new secret and
// lands in the canonical per-agent file "<agentId>.json".
function splitName(
  name: string,
  agentId: string,
): { scope: string; realKey: string } {
  const slash = name.indexOf('/');
  if (slash === -1) return { scope: agentId, realKey: name };
  return {
    scope: name.slice(0, slash) || agentId,
    realKey: name.slice(slash + 1),
  };
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
