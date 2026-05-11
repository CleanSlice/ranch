import { createHash, randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import { IApiKeyGateway } from './apiKey.gateway';
import {
  ApiKeyScopeTypes,
  IApiKeyData,
  ICreateApiKeyData,
  ICreatedApiKey,
} from './apiKey.types';

const KEY_PREFIX = 'rk_';
const KEY_BYTES = 32;

@Injectable()
export class ApiKeyService {
  constructor(private gateway: IApiKeyGateway) {}

  async list(): Promise<IApiKeyData[]> {
    return this.gateway.findAll();
  }

  async create(data: ICreateApiKeyData): Promise<ICreatedApiKey> {
    const key = `${KEY_PREFIX}${randomBytes(KEY_BYTES).toString('base64url')}`;
    const keyHash = this.hash(key);
    const prefix = key.slice(-4);
    const apiKey = await this.gateway.create({ ...data, keyHash, prefix });
    return { apiKey, key };
  }

  async revoke(id: string): Promise<void> {
    await this.gateway.delete(id);
  }

  /** Verifies a plaintext key, returns the row, and fire-and-forget updates lastUsedAt.
   *  Returns null if not found, revoked, or expired. */
  async verify(rawKey: string): Promise<IApiKeyData | null> {
    if (!rawKey.startsWith(KEY_PREFIX)) return null;
    const found = await this.gateway.findByHash(this.hash(rawKey));
    if (!found) return null;
    if (found.expiresAt && found.expiresAt.getTime() < Date.now()) return null;
    void this.gateway.touchLastUsed(found.id).catch(() => undefined);
    return found;
  }

  hasScope(apiKey: IApiKeyData, scope: ApiKeyScopeTypes): boolean {
    return (
      apiKey.scopes.includes(scope) ||
      apiKey.scopes.includes(ApiKeyScopeTypes.Admin)
    );
  }

  private hash(rawKey: string): string {
    return createHash('sha256').update(rawKey).digest('hex');
  }
}
