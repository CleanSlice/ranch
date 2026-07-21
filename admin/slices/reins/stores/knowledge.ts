import { createServiceGetter } from '#common/composables/createServiceGetter';
import type {
  ICreateKnowledgeInput,
  IGraph,
  IKnowledge,
  IKnowledgeSetupStatus,
  IQueryResult,
  ISource,
  IUpdateKnowledgeInput,
  KnowledgeQueryMode,
  KnowledgeService,
} from '#reins/domain';

// Re-export the domain types so consumers importing them from
// `#reins/stores/knowledge` (knowledge List/Edit/Query/Sources/Setup, badges)
// keep working.
export type {
  ICreateKnowledgeInput,
  IGraph,
  IKnowledge,
  IKnowledgeSetupStatus,
  IndexStatus,
  IQueryResult,
  ISource,
  IUpdateKnowledgeInput,
  SourceType,
} from '#reins/domain';

const EMPTY_SETUP: IKnowledgeSetupStatus = {
  hasChatCredential: false,
  hasEmbeddingCredential: false,
  hasUrl: false,
  hasBucket: false,
  hasCredentialsSelected: false,
  isHealthy: false,
};

const getService = createServiceGetter<KnowledgeService>('$knowledgeService');

export const useKnowledgeStore = defineStore('reins-knowledge', () => {
  const items = ref<IKnowledge[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const enabled = ref<boolean>(false);
  const statusChecked = ref<boolean>(false);
  const setup = ref<IKnowledgeSetupStatus>(EMPTY_SETUP);

  async function fetchStatus(): Promise<boolean> {
    const status = await getService().status();
    enabled.value = status.enabled;
    setup.value = status.setup;
    statusChecked.value = true;
    return enabled.value;
  }

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

  async function create(body: ICreateKnowledgeInput) {
    const created = await getService().create(body);
    if (created) items.value.unshift(created);
    return created;
  }

  async function update(id: string, body: IUpdateKnowledgeInput) {
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

  async function startIndex(id: string) {
    await getService().index(id);
    const fresh = await fetchById(id);
    if (fresh) {
      const idx = items.value.findIndex((x) => x.id === id);
      if (idx >= 0) items.value.splice(idx, 1, fresh);
    }
    return fresh;
  }

  function query(
    id: string,
    q: string,
    mode: KnowledgeQueryMode = 'hybrid',
    topK = 10,
  ): Promise<IQueryResult> {
    return getService().query(id, q, mode, topK);
  }

  function listSources(id: string) {
    return getService().listSources(id);
  }

  function addTextSource(id: string, name: string, content: string) {
    return getService().addTextSource(id, name, content);
  }

  function addUrlSource(id: string, name: string, url: string) {
    return getService().addUrlSource(id, name, url);
  }

  function addFileSource(id: string, file: File) {
    return getService().addFileSource(id, file);
  }

  function addSourcesFromArchive(id: string, file: File) {
    return getService().addSourcesFromArchive(id, file);
  }

  function addSourcesFromSitemap(
    id: string,
    sitemapUrl: string,
    urlPrefix?: string,
  ) {
    return getService().addSourcesFromSitemap(id, sitemapUrl, urlPrefix);
  }

  function removeSource(id: string, sourceId: string) {
    return getService().removeSource(id, sourceId);
  }

  function getGraphLabels() {
    return getService().graphLabels();
  }

  function getGraph(
    label: string,
    maxDepth: number,
    maxNodes: number,
  ): Promise<IGraph> {
    return getService().graph(label, maxDepth, maxNodes);
  }

  return {
    items,
    loading,
    error,
    enabled,
    statusChecked,
    setup,
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
    addSourcesFromSitemap,
    addSourcesFromArchive,
    removeSource,
    getGraphLabels,
    getGraph,
  };
});
