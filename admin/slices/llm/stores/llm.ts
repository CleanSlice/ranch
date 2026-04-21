import { LlmsService } from '#api/data';

type ApiEnvelope<T> = { success: boolean; data: T };

export interface ILlmCredentialData {
  id: string;
  provider: string;
  model: string;
  label: string | null;
  apiKey: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface ILlmCredentialInput {
  provider: string;
  model: string;
  apiKey: string;
  label?: string;
  status?: string;
}

function unwrap<T>(body: unknown): T | null {
  if (body && typeof body === 'object' && 'data' in (body as ApiEnvelope<T>)) {
    return ((body as ApiEnvelope<T>).data ?? null) as T | null;
  }
  return (body ?? null) as T | null;
}

export const useLlmStore = defineStore('llm', () => {
  const items = ref<ILlmCredentialData[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchAll() {
    loading.value = true;
    error.value = null;
    try {
      const res = await LlmsService.llmControllerFindAll();
      items.value = unwrap<ILlmCredentialData[]>(res.data) ?? [];
    } catch (err) {
      error.value = (err as Error).message;
    } finally {
      loading.value = false;
    }
    return items.value;
  }

  async function create(body: ILlmCredentialInput) {
    const res = await LlmsService.llmControllerCreate({ body });
    const created = unwrap<ILlmCredentialData>(res.data);
    if (created) items.value.push(created);
    return created;
  }

  async function update(id: string, body: Partial<ILlmCredentialInput>) {
    const res = await LlmsService.llmControllerUpdate({
      path: { id },
      body,
    });
    const updated = unwrap<ILlmCredentialData>(res.data);
    if (updated) {
      const idx = items.value.findIndex((x) => x.id === id);
      if (idx >= 0) items.value.splice(idx, 1, updated);
    }
    return updated;
  }

  async function remove(id: string) {
    await LlmsService.llmControllerRemove({ path: { id } });
    items.value = items.value.filter((x) => x.id !== id);
  }

  return { items, loading, error, fetchAll, create, update, remove };
});
