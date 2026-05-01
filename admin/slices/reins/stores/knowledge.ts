import { KnowledgesService, KnowledgeSourcesService } from '#api/data';
import type { GraphDto, KnowledgeQueryResultDto } from '#api/data';
import { client as apiClient } from '#api/data/repositories/api/client.gen';

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
  sources?: ISource[];
}

export interface ISource {
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

export type IQueryResult = KnowledgeQueryResultDto;

function unwrap<T>(body: unknown): T | null {
  if (body && typeof body === 'object' && 'data' in (body as ApiEnvelope<T>)) {
    return ((body as ApiEnvelope<T>).data ?? null) as T | null;
  }
  return (body ?? null) as T | null;
}

function isStatusBody(value: unknown): value is { enabled: boolean } {
  if (typeof value !== 'object' || value === null) return false;
  if (!('enabled' in value)) return false;
  return typeof value.enabled === 'boolean';
}

export const useKnowledgeStore = defineStore('reins-knowledge', () => {
  const items = ref<IKnowledge[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const enabled = ref<boolean>(false);
  const statusChecked = ref<boolean>(false);

  async function fetchStatus(): Promise<boolean> {
    try {
      const res = await apiClient.get<unknown>({ url: '/knowledges/status' });
      const body = unwrap<unknown>(res.data);
      if (isStatusBody(body)) {
        enabled.value = body.enabled;
      } else {
        enabled.value = false;
      }
    } catch {
      enabled.value = false;
    }
    statusChecked.value = true;
    return enabled.value;
  }

  async function fetchAll() {
    loading.value = true;
    error.value = null;
    try {
      const res = await KnowledgesService.getKnowledges();
      items.value = unwrap<IKnowledge[]>(res.data) ?? [];
    } catch (err) {
      error.value = (err as Error).message;
    } finally {
      loading.value = false;
    }
    return items.value;
  }

  async function fetchById(id: string) {
    const res = await KnowledgesService.getKnowledge({ path: { id } });
    return unwrap<IKnowledge>(res.data);
  }

  async function create(body: ICreateKnowledgeInput) {
    const res = await KnowledgesService.createKnowledge({ body });
    const created = unwrap<IKnowledge>(res.data);
    if (created) items.value.unshift(created);
    return created;
  }

  async function update(id: string, body: IUpdateKnowledgeInput) {
    const res = await KnowledgesService.updateKnowledge({ path: { id }, body });
    const updated = unwrap<IKnowledge>(res.data);
    if (updated) {
      const idx = items.value.findIndex((x) => x.id === id);
      if (idx >= 0) items.value.splice(idx, 1, updated);
    }
    return updated;
  }

  async function remove(id: string) {
    await KnowledgesService.deleteKnowledge({ path: { id } });
    items.value = items.value.filter((x) => x.id !== id);
  }

  async function startIndex(id: string) {
    await KnowledgesService.indexKnowledge({ path: { id } });
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
    topK = 10,
  ): Promise<IQueryResult> {
    const res = await KnowledgesService.queryKnowledge({
      path: { id },
      body: { query: q, mode, topK },
    });
    return (
      unwrap<IQueryResult>(res.data) ?? { answer: '', references: [] }
    );
  }

  async function listSources(id: string) {
    const res = await KnowledgeSourcesService.getKnowledgeSources({
      path: { knowledgeId: id },
    });
    return unwrap<ISource[]>(res.data) ?? [];
  }

  async function addTextSource(id: string, name: string, content: string) {
    const res = await KnowledgeSourcesService.addKnowledgeSource({
      path: { knowledgeId: id },
      body: { type: 'text', name, content },
    });
    return unwrap<ISource>(res.data);
  }

  async function addUrlSource(id: string, name: string, url: string) {
    const res = await KnowledgeSourcesService.addKnowledgeSource({
      path: { knowledgeId: id },
      body: { type: 'url', name, url },
    });
    return unwrap<ISource>(res.data);
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
    return unwrap<ISource>(res);
  }

  async function removeSource(id: string, sourceId: string) {
    await KnowledgeSourcesService.deleteKnowledgeSource({
      path: { knowledgeId: id, sourceId },
    });
  }

  async function getGraphLabels(): Promise<string[]> {
    const res = await KnowledgesService.getGraphLabels();
    const list = unwrap<unknown>(res.data);
    if (!Array.isArray(list)) return [];
    return list.filter((x): x is string => typeof x === 'string');
  }

  async function getGraph(
    label: string,
    maxDepth: number,
    maxNodes: number,
  ): Promise<GraphDto> {
    const res = await KnowledgesService.getGraph({
      query: { label, maxDepth, maxNodes },
    });
    const data = unwrap<GraphDto>(res.data);
    return data ?? { nodes: [], edges: [], isTruncated: false };
  }

  return {
    items,
    loading,
    error,
    enabled,
    statusChecked,
    fetchStatus,
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
    getGraphLabels,
    getGraph,
  };
});
