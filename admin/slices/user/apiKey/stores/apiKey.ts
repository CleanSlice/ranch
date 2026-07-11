import { ApiKeysService } from '#api/data';
import type { CreateApiKeyDto } from '#api/data';

type ApiEnvelope<T> = { success: boolean; data: T };

/** Mirror of the API enum, with code-friendly key names. Values match
 *  what the generated SDK / hub expect on the wire. */
export enum ApiKeyScopeTypes {
  EmbedMint = 'embed:mint',
  EmbedMintAdmin = 'embed:mint-admin',
  Admin = 'admin',
}

export interface IApiKeyData {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiKeyScopeTypes[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdBy: string;
  createdAt: string;
}

export interface ICreateApiKeyInput {
  name: string;
  scopes: ApiKeyScopeTypes[];
  expiresAt?: string;
}

export interface ICreatedApiKey {
  apiKey: IApiKeyData;
  /** Plaintext key — returned exactly once at creation. */
  key: string;
}

function unwrap<T>(body: unknown): T | null {
  if (body && typeof body === 'object' && 'data' in (body as ApiEnvelope<T>)) {
    return ((body as ApiEnvelope<T>).data ?? null) as T | null;
  }
  return (body ?? null) as T | null;
}

export const useApiKeyStore = defineStore('apiKey', () => {
  const items = ref<IApiKeyData[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchAll() {
    loading.value = true;
    error.value = null;
    try {
      const res = await ApiKeysService.apiKeyControllerFindAll();
      items.value = unwrap<IApiKeyData[]>(res.data) ?? [];
    } catch (err) {
      error.value = (err as Error).message;
    } finally {
      loading.value = false;
    }
    return items.value;
  }

  async function create(body: ICreateApiKeyInput): Promise<ICreatedApiKey | null> {
    // Local enum values match the generated wire-level enum's values, but
    // their TS identities differ (different declaration sites). Cast at the
    // boundary so the SDK accepts our scopes array.
    const res = await ApiKeysService.apiKeyControllerCreate({
      body: body as unknown as CreateApiKeyDto,
    });
    const created = unwrap<ICreatedApiKey>(res.data);
    if (created) items.value.unshift(created.apiKey);
    return created;
  }

  async function remove(id: string) {
    await ApiKeysService.apiKeyControllerRemove({ path: { id } });
    items.value = items.value.filter((x) => x.id !== id);
  }

  return {
    items,
    loading,
    error,
    fetchAll,
    create,
    remove,
  };
});
