import { Injectable } from '@nestjs/common';
import { ApiKey } from '@prisma/client';
import {
  ALL_API_KEY_SCOPES,
  ApiKeyScopeTypes,
  IApiKeyData,
  ICreateApiKeyData,
} from '../domain';

const VALID_SCOPES = new Set<string>(ALL_API_KEY_SCOPES);

@Injectable()
export class ApiKeyMapper {
  toEntity(record: ApiKey): IApiKeyData {
    return {
      id: record.id,
      name: record.name,
      prefix: record.prefix,
      scopes: this.normalizeScopes(record.scopes),
      lastUsedAt: record.lastUsedAt,
      expiresAt: record.expiresAt,
      createdBy: record.createdBy,
      createdAt: record.createdAt,
    };
  }

  toCreate(data: ICreateApiKeyData & { keyHash: string; prefix: string }) {
    return {
      id: `apikey-${crypto.randomUUID()}`,
      name: data.name,
      keyHash: data.keyHash,
      prefix: data.prefix,
      scopes: this.normalizeScopes(data.scopes),
      expiresAt: data.expiresAt ?? null,
      createdBy: data.createdBy,
    };
  }

  /** Drop unknown values, dedupe; never falls back — empty scopes means a key that authenticates but unlocks no endpoints. */
  normalizeScopes(
    scopes: readonly string[] | null | undefined,
  ): ApiKeyScopeTypes[] {
    if (!scopes?.length) return [];
    return Array.from(
      new Set(scopes.filter((s): s is ApiKeyScopeTypes => VALID_SCOPES.has(s))),
    );
  }
}
