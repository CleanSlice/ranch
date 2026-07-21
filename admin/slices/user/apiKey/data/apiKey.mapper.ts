import type { CreateApiKeyDto } from '#api/data';
import {
  ApiKeyScopeTypes,
  type IApiKeyData,
  type ICreateApiKeyInput,
  type ICreatedApiKey,
} from '../domain/apiKey.types';

const SCOPE_VALUES = new Set<string>(Object.values(ApiKeyScopeTypes));

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function nullableStr(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** Maps the API-keys API onto domain shapes; reads defensively. */
export class ApiKeyMapper {
  toEntity(raw: unknown): IApiKeyData | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    if (typeof o.id !== 'string') return null;
    return {
      id: o.id,
      name: str(o.name),
      prefix: str(o.prefix),
      scopes: this.toScopes(o.scopes),
      lastUsedAt: nullableStr(o.lastUsedAt),
      expiresAt: nullableStr(o.expiresAt),
      createdBy: str(o.createdBy),
      createdAt: str(o.createdAt),
    };
  }

  toList(raw: unknown): IApiKeyData[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) => this.toEntity(item))
      .filter((k): k is IApiKeyData => k !== null);
  }

  toCreated(raw: unknown): ICreatedApiKey | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    const apiKey = this.toEntity(o.apiKey);
    if (!apiKey || typeof o.key !== 'string') return null;
    return { apiKey, key: o.key };
  }

  // Local enum values match the wire enum's values but their TS identities
  // differ; cast at the boundary so the SDK accepts our scopes array.
  toCreateDto(input: ICreateApiKeyInput): CreateApiKeyDto {
    return input as unknown as CreateApiKeyDto;
  }

  private toScopes(raw: unknown): ApiKeyScopeTypes[] {
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (s): s is ApiKeyScopeTypes => typeof s === 'string' && SCOPE_VALUES.has(s),
    );
  }
}
