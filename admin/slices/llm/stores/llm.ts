import { createServiceGetter } from '#common/composables/createServiceGetter';
import type {
  ILlmCredentialData,
  ILlmCredentialInput,
  LlmService,
} from '#llm/domain';

// Re-export the domain types so consumers importing them from
// `#llm/stores/llm` (Form, llmList/Create/Edit Providers, settings/knowledge)
// keep working.
export type {
  ILlmCredentialData,
  ILlmCredentialInput,
  ILlmHealthCheckResult,
} from '#llm/domain';

const getService = createServiceGetter<LlmService>('$llmService');

export const useLlmStore = defineStore('llm', () => {
  const items = ref<ILlmCredentialData[]>([]);
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

  function fetchById(id: string) {
    return getService().findById(id);
  }

  async function create(body: ILlmCredentialInput) {
    const created = await getService().create(body);
    if (created) items.value.push(created);
    return created;
  }

  async function update(id: string, body: Partial<ILlmCredentialInput>) {
    const updated = await getService().update(id, body);
    if (updated) {
      const idx = items.value.findIndex((x) => x.id === id);
      if (idx >= 0) items.value.splice(idx, 1, updated);
    }
    return updated;
  }

  async function remove(id: string) {
    await getService().remove(id);
    items.value = items.value.filter((x) => x.id !== id);
  }

  function checkHealth(id: string) {
    return getService().checkHealth(id);
  }

  return {
    items,
    loading,
    error,
    fetchAll,
    fetchById,
    create,
    update,
    remove,
    checkHealth,
  };
});
