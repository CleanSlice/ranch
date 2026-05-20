import { BadRequestException, Injectable } from '@nestjs/common';
import {
  CreateSecretCommand,
  GetSecretValueCommand,
  ListSecretsCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
  SecretsManagerServiceException,
} from '@aws-sdk/client-secrets-manager';
import { ISettingGateway } from '#/setting/domain';
import {
  IUserSecretEntry,
  IUserSecretListData,
  UserSecretProviderTypes,
} from '../domain/secret.types';

const PROVIDER: UserSecretProviderTypes = 'aws';

/**
 * Per-user AWS Secrets Manager gateway. Same JSON-blob-per-scope shape as
 * agent/secret's AWS gateway — kept as a separate class instead of a
 * shared generic because the prefix setting and ownership semantics
 * differ enough that conflating them risks leaking one scope's secrets
 * into the other's audit trail.
 */
@Injectable()
export class AwsUserSecretGateway {
  constructor(private settings: ISettingGateway) {}

  async list(userId: string): Promise<IUserSecretListData> {
    const { client, prefix } = await this.connect();
    const secretId = `${prefix}/${userId}`;

    let payload: string | undefined;
    let updatedAt: Date | null = null;
    try {
      const res = await client.send(
        new GetSecretValueCommand({ SecretId: secretId }),
      );
      payload = res.SecretString ?? undefined;
      updatedAt = res.CreatedDate ?? null;
    } catch (err) {
      if (this.isNotFound(err)) return { provider: PROVIDER, secrets: [] };
      throw err;
    }

    const updated = await this.fetchLastChanged(client, secretId, updatedAt);
    const entries = parseSecretJson(payload, updated);
    return { provider: PROVIDER, secrets: entries };
  }

  async get(userId: string, key: string): Promise<string | null> {
    const { client, prefix } = await this.connect();
    const store = await this.loadRaw(client, `${prefix}/${userId}`);
    return store[key] ?? null;
  }

  async set(userId: string, key: string, value: string): Promise<void> {
    const { client, prefix } = await this.connect();
    const secretId = `${prefix}/${userId}`;
    const store = await this.loadRaw(client, secretId);
    store[key] = value;
    await this.writeStore(client, secretId, store);
  }

  async delete(userId: string, key: string): Promise<void> {
    const { client, prefix } = await this.connect();
    const secretId = `${prefix}/${userId}`;
    const store = await this.loadRaw(client, secretId);
    if (!(key in store)) return;
    delete store[key];
    await this.writeStore(client, secretId, store);
  }

  private async loadRaw(
    client: SecretsManagerClient,
    secretId: string,
  ): Promise<Record<string, string>> {
    try {
      const res = await client.send(
        new GetSecretValueCommand({ SecretId: secretId }),
      );
      const parsed: unknown = res.SecretString
        ? JSON.parse(res.SecretString)
        : {};
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

  private async writeStore(
    client: SecretsManagerClient,
    secretId: string,
    store: Record<string, string>,
  ): Promise<void> {
    const SecretString = JSON.stringify(store);
    try {
      await client.send(
        new PutSecretValueCommand({ SecretId: secretId, SecretString }),
      );
    } catch (err) {
      if (this.isNotFound(err)) {
        await client.send(
          new CreateSecretCommand({ Name: secretId, SecretString }),
        );
        return;
      }
      throw err;
    }
  }

  private async fetchLastChanged(
    client: SecretsManagerClient,
    secretId: string,
    fallback: Date | null,
  ): Promise<Date | null> {
    try {
      const res = await client.send(
        new ListSecretsCommand({
          Filters: [{ Key: 'name', Values: [secretId] }],
          MaxResults: 1,
        }),
      );
      return res.SecretList?.[0]?.LastChangedDate ?? fallback;
    } catch {
      return fallback;
    }
  }

  private isNotFound(err: unknown): boolean {
    if (err instanceof SecretsManagerServiceException) {
      return err.name === 'ResourceNotFoundException';
    }
    return false;
  }

  private async connect(): Promise<{
    client: SecretsManagerClient;
    prefix: string;
  }> {
    const get = async (name: string): Promise<string> => {
      const setting = await this.settings.findByKey('integrations', name);
      const value = setting?.value;
      return typeof value === 'string' ? value : '';
    };

    const [region, accessKeyId, secretAccessKey, prefix] = await Promise.all([
      get('aws_region'),
      get('aws_access_key_id'),
      get('aws_secret_access_key'),
      get('aws_user_secret_prefix'),
    ]);

    if (!accessKeyId || !secretAccessKey) {
      throw new BadRequestException(
        'AWS credentials are not configured (settings → integrations)',
      );
    }
    if (!prefix) {
      throw new BadRequestException(
        'AWS Secrets Manager user prefix is not configured (settings → integrations → aws_user_secret_prefix)',
      );
    }

    const client = new SecretsManagerClient({
      region: region || 'us-east-1',
      credentials: { accessKeyId, secretAccessKey },
    });

    return { client, prefix: prefix.replace(/\/+$/, '') };
  }
}

function parseSecretJson(
  payload: string | undefined,
  updatedAt: Date | null,
): IUserSecretEntry[] {
  if (!payload) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
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
