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
  ISecretEntry,
  ISecretListData,
  SecretProviderTypes,
} from '../domain/secret.types';

const PROVIDER: SecretProviderTypes = 'aws';

@Injectable()
export class AwsSecretGateway {
  constructor(private settings: ISettingGateway) {}

  async list(agentId: string): Promise<ISecretListData> {
    const { client, prefix } = await this.connect();
    const secretId = `${prefix}/${agentId}`;

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

  async set(agentId: string, key: string, value: string): Promise<void> {
    const { client, prefix } = await this.connect();
    const secretId = `${prefix}/${agentId}`;
    const store = await this.loadRaw(client, secretId);
    store[key] = value;
    await this.writeStore(client, secretId, store);
  }

  async delete(agentId: string, key: string): Promise<void> {
    const { client, prefix } = await this.connect();
    const secretId = `${prefix}/${agentId}`;
    const store = await this.loadRaw(client, secretId);
    if (!(key in store)) return;
    delete store[key];
    await this.writeStore(client, secretId, store);
  }

  async replaceAll(
    agentId: string,
    store: Record<string, string>,
  ): Promise<void> {
    const { client, prefix } = await this.connect();
    await this.writeStore(client, `${prefix}/${agentId}`, store);
  }

  // The whole agent store is one JSON blob. Read it, mutate one key, write it
  // back — so set/delete must round-trip the full object.
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
      get('aws_secret_prefix'),
    ]);

    if (!accessKeyId || !secretAccessKey) {
      throw new BadRequestException(
        'AWS credentials are not configured (settings → integrations)',
      );
    }
    if (!prefix) {
      throw new BadRequestException(
        'AWS Secrets Manager prefix is not configured (settings → integrations → aws_secret_prefix)',
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
): ISecretEntry[] {
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
