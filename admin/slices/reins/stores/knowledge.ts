import { createServiceGetter } from '#common/composables/createServiceGetter';
import type {
  ICreateKnowledgeInput,
  IGraph,
  IImportJob,
  IKnowledge,
  IKnowledgeRuntimeConfig,
  IKnowledgeSetupStatus,
  IQueryResult,
  ISource,
  ISourceContent,
  ISourceExportSelection,
  ISourceFilter,
  ISourcePage,
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
  IImportJob,
  IKnowledge,
  IKnowledgePage,
  IKnowledgeRuntimeConfig,
  IKnowledgeSetupStatus,
  IndexStatus,
  IQueryResult,
  ISource,
  ISourceContent,
  ISourceExportSelection,
  ISourceFilter,
  ISourcePage,
  IUpdateKnowledgeInput,
  SourceIndexStatus,
  SourceType,
} from '#reins/domain';

/** An object URL plus what it points at; call `revoke()` when done with it. */
export interface ISourcePreview {
  url: string;
  blob: Blob;
  filename: string;
  contentType: string;
  size: number;
  revoke: () => void;
}

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
  const runtime = ref<IKnowledgeRuntimeConfig | null>(null);

  async function fetchStatus(): Promise<boolean> {
    const status = await getService().status();
    enabled.value = status.enabled;
    setup.value = status.setup;
    runtime.value = status.runtime;
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

  function fetchPage(search: string | undefined, page: number, perPage = 50) {
    return getService().findPage(search, page, perPage);
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

  function listSources(id: string, filter: ISourceFilter): Promise<ISourcePage> {
    return getService().listSources(id, filter);
  }

  function listImports(id: string): Promise<IImportJob[]> {
    return getService().listImports(id);
  }

  // Fetches the bytes with the Bearer header and hands back an object URL the
  // preview sheet can iframe / the browser can open. The caller owns the URL.
  async function previewSource(
    id: string,
    sourceId: string,
  ): Promise<ISourcePreview> {
    const content: ISourceContent = await getService().fetchSourceContent(
      id,
      sourceId,
      'inline',
    );
    const url = URL.createObjectURL(content.blob);
    return {
      url,
      blob: content.blob,
      filename: content.filename,
      contentType: content.contentType,
      size: content.blob.size,
      revoke: () => URL.revokeObjectURL(url),
    };
  }

  async function downloadSource(id: string, sourceId: string): Promise<void> {
    const content = await getService().fetchSourceContent(
      id,
      sourceId,
      'attachment',
    );
    const url = URL.createObjectURL(content.blob);
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = content.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      // Give the click a tick to start the download before pulling the URL.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  /**
   * Downloads the selection as a zip. Same blob-and-anchor dance as
   * downloadSource: the endpoint returns raw bytes rather than the JSON
   * envelope, and a plain link cannot carry the bearer token.
   */
  async function exportSources(
    id: string,
    selection: ISourceExportSelection,
  ): Promise<void> {
    const content = await getService().exportSources(id, selection);
    const url = URL.createObjectURL(content.blob);
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = content.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
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

  function addFileSources(id: string, files: File[]) {
    return getService().addFileSources(id, files);
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

  function reindexSource(id: string, sourceId: string) {
    return getService().reindexSource(id, sourceId);
  }

  function getGraphLabels(id: string, search?: string, limit?: number) {
    return getService().graphLabels(id, search, limit);
  }

  function getGraph(
    id: string,
    label: string,
    maxDepth: number,
    maxNodes: number,
  ): Promise<IGraph> {
    return getService().graph(id, label, maxDepth, maxNodes);
  }

  return {
    items,
    loading,
    error,
    enabled,
    statusChecked,
    setup,
    runtime,
    fetchStatus,
    fetchAll,
    fetchById,
    fetchPage,
    create,
    update,
    remove,
    startIndex,
    query,
    listSources,
    listImports,
    previewSource,
    downloadSource,
    exportSources,
    addTextSource,
    addUrlSource,
    addFileSource,
    addFileSources,
    addSourcesFromSitemap,
    addSourcesFromArchive,
    removeSource,
    reindexSource,
    getGraphLabels,
    getGraph,
  };
});
