import { createServiceGetter } from '#common/composables/createServiceGetter';
import type {
  ApiKeyService,
  IApiKeyData,
  ICreateApiKeyInput,
} from '#apiKey/domain';

// Re-export the domain enum/types so consumers importing them from
// `#apiKey/stores/apiKey` (apiKey List/CreateDialog/Provider/CreatedKeyDisplay)
// keep working. `ApiKeyScopeTypes` is used as a value.
export { ApiKeyScopeTypes } from '#apiKey/domain';
export type { IApiKeyData, ICreateApiKeyInput, ICreatedApiKey } from '#apiKey/domain';

const getService = createServiceGetter<ApiKeyService>('$apiKeyService');

export const useApiKeyStore = defineStore('apiKey', () => {
  const items = ref<IApiKeyData[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchAll() {
    loading.value = true;
    error.value = null;
    try {
      items.value = await getService().findAll();
    } catch (err) {
      error.value = (err as Error).message;
    } finally {
      loading.value = false;
    }
    return items.value;
  }

  async function create(body: ICreateApiKeyInput) {
    const created = await getService().create(body);
    if (created) items.value.unshift(created.apiKey);
    return created;
  }

  async function remove(id: string) {
    await getService().remove(id);
    items.value = items.value.filter((x) => x.id !== id);
  }

  return { items, loading, error, fetchAll, create, remove };
});
