import { ReinsService } from '#api/data';

type ApiEnvelope<T> = { success: boolean; data: T };

export type IndexStatus = 'idle' | 'indexing' | 'ready' | 'failed';
export type SourceType = 'file' | 'url' | 'text';

export interface IKnowledge {
  id: string;
  name: string;
  description: string | null;
  entityTypes: string[];
  relationshipTypes: string[];
  indexStatus: IndexStatus;
  indexError: string | null;
  indexedAt: string | null;
  indexStartedAt: string | null;
  createdAt: string;
  updatedAt: string;
  sources?: IReinsSource[];
}

export interface IReinsSource {
  id: string;
  knowledgeId: string;
  type: SourceType;
  name: string;
  url: string | null;
  mimeType: string | null;
  content: string | null;
  sizeBytes: number | null;
  indexed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ICreateKnowledgeInput {
  name: string;
  description?: string;
  entityTypes?: string[];
  relationshipTypes?: string[];
}

export interface IUpdateKnowledgeInput {
  name?: string;
  description?: string | null;
  entityTypes?: string[];
  relationshipTypes?: string[];
}

export interface IQueryRecord {
  pageContent: string;
  metadata: {
    title?: string;
    source?: string;
    sourceId?: string;
  };
}

function unwrap<T>(body: unknown): T | null {
  if (body && typeof body === 'object' && 'data' in (body as ApiEnvelope<T>)) {
    return ((body as ApiEnvelope<T>).data ?? null) as T | null;
  }
  return (body ?? null) as T | null;
}

export const useKnowledgeStore = defineStore('reins-knowledge', () => {
  const items = ref<IKnowledge[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchAll() {
    loading.value = true;
    error.value = null;
    try {
      const res = await ReinsService.getKnowledges();
      items.value = unwrap<IKnowledge[]>(res.data) ?? [];
    } catch (err) {
      error.value = (err as Error).message;
    } finally {
      loading.value = false;
    }
    return items.value;
  }

  async function fetchById(id: string) {
    const res = await ReinsService.getKnowledge({ path: { id } });
    return unwrap<IKnowledge>(res.data);
  }

  async function create(body: ICreateKnowledgeInput) {
    const res = await ReinsService.createKnowledge({ body });
    const created = unwrap<IKnowledge>(res.data);
    if (created) items.value.unshift(created);
    return created;
  }

  async function update(id: string, body: IUpdateKnowledgeInput) {
    const res = await ReinsService.updateKnowledge({ path: { id }, body });
    const updated = unwrap<IKnowledge>(res.data);
    if (updated) {
      const idx = items.value.findIndex((x) => x.id === id);
      if (idx >= 0) items.value.splice(idx, 1, updated);
    }
    return updated;
  }

  async function remove(id: string) {
    await ReinsService.deleteKnowledge({ path: { id } });
    items.value = items.value.filter((x) => x.id !== id);
  }

  async function startIndex(id: string) {
    await ReinsService.indexKnowledge({ path: { id } });
    const fresh = await fetchById(id);
    if (fresh) {
      const idx = items.value.findIndex((x) => x.id === id);
      if (idx >= 0) items.value.splice(idx, 1, fresh);
    }
    return fresh;
  }

  async function query(
    id: string,
    q: string,
    mode: 'hybrid' | 'local' | 'global' | 'naive' = 'hybrid',
    topK = 25,
  ) {
    const res = await ReinsService.getKnowledgeRecords({
      path: { id },
      query: { query: q, mode, topK },
    });
    return unwrap<IQueryRecord[]>(res.data) ?? [];
  }

  async function listSources(id: string) {
    const res = await ReinsService.getKnowledgeSources({ path: { id } });
    return unwrap<IReinsSource[]>(res.data) ?? [];
  }

  async function addTextSource(id: string, name: string, content: string) {
    const res = await ReinsService.addKnowledgeSource({
      path: { id },
      body: { type: 'text', name, content },
    });
    return unwrap<IReinsSource>(res.data);
  }

  async function addUrlSource(id: string, name: string, url: string) {
    const res = await ReinsService.addKnowledgeSource({
      path: { id },
      body: { type: 'url', name, url },
    });
    return unwrap<IReinsSource>(res.data);
  }

  async function addFileSource(id: string, file: File) {
    const form = new FormData();
    form.append('type', 'file');
    form.append('name', file.name);
    form.append('file', file);
    const res = await $fetch<unknown>(`/api/knowledges/${id}/sources`, {
      method: 'POST',
      body: form,
    });
    return unwrap<IReinsSource>(res);
  }

  async function removeSource(id: string, sourceId: string) {
    await ReinsService.deleteKnowledgeSource({
      path: { id, sourceId },
    });
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
    startIndex,
    query,
    listSources,
    addTextSource,
    addUrlSource,
    addFileSource,
    removeSource,
  };
});
