import { KnowledgesService, KnowledgeSourcesService } from '#api/data';
import { client as apiClient } from '#api/data/repositories/api/client.gen';
import { BaseGateway } from '#common/data/BaseGateway';
import { unwrapEnvelope } from '#common/data/unwrapEnvelope';
import { IKnowledgeGateway } from '../domain/knowledge.gateway';
import type {
  ICreateKnowledgeInput,
  IGraph,
  IGraphLabels,
  IImportJob,
  IKnowledge,
  IKnowledgePage,
  IKnowledgeStatus,
  IQueryResult,
  ISource,
  ISourceArchiveResult,
  ISourceContent,
  ISourceExportSelection,
  ISourceFilesResult,
  ISourceFilter,
  ISourcePage,
  ISourceSitemapResult,
  IUpdateKnowledgeInput,
  KnowledgeQueryMode,
  SourceContentDisposition,
} from '../domain/knowledge.types';
import { KnowledgeMapper } from './knowledge.mapper';

/**
 * Pulls the human filename out of a Content-Disposition header, preferring
 * the RFC 5987 `filename*` (UTF-8, survives Cyrillic) over the ASCII
 * fallback `filename`.
 */
function filenameFromDisposition(header: unknown, fallback: string): string {
  if (typeof header !== 'string') return fallback;
  const utf8 = header.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (utf8) {
    try {
      return decodeURIComponent(utf8);
    } catch {
      // Malformed encoding: fall through to the plain filename.
    }
  }
  return header.match(/filename="?([^";]+)"?/)?.[1] ?? fallback;
}

export class KnowledgeGateway extends BaseGateway implements IKnowledgeGateway {
  private mapper = new KnowledgeMapper();

  // Raw client: /knowledges/status isn't in the generated SDK. Swallow errors
  // to a disabled/empty status (mirrors the store's try/catch).
  status(): Promise<IKnowledgeStatus> {
    return this.execute(async () => {
      try {
        const res = await apiClient.get({ url: '/knowledges/status' });
        return this.mapper.toStatus(unwrapEnvelope(res.data));
      } catch {
        return this.mapper.toStatus(null);
      }
    });
  }

  // Callers that need "everything" (binding resolution) read the first
  // page at the maximum size — a personal installation holds low tens.
  findAll(): Promise<IKnowledge[]> {
    return this.execute(async () => {
      const res = await KnowledgesService.getKnowledges({
        query: { perPage: 100 },
      });
      return this.mapper.toKnowledgePage(unwrapEnvelope(res.data)).items;
    });
  }

  findPage(
    search: string | undefined,
    page: number,
    perPage: number,
  ): Promise<IKnowledgePage> {
    return this.execute(async () => {
      const res = await KnowledgesService.getKnowledges({
        query: { search: search || undefined, page, perPage },
      });
      return this.mapper.toKnowledgePage(unwrapEnvelope(res.data));
    });
  }

  findById(id: string): Promise<IKnowledge | null> {
    return this.execute(async () => {
      const res = await KnowledgesService.getKnowledge({ path: { id } });
      return this.mapper.toKnowledge(unwrapEnvelope(res.data));
    });
  }

  create(input: ICreateKnowledgeInput): Promise<IKnowledge | null> {
    return this.execute(async () => {
      const res = await KnowledgesService.createKnowledge({ body: input });
      return this.mapper.toKnowledge(unwrapEnvelope(res.data));
    });
  }

  update(
    id: string,
    input: IUpdateKnowledgeInput,
  ): Promise<IKnowledge | null> {
    return this.execute(async () => {
      const res = await KnowledgesService.updateKnowledge({
        path: { id },
        body: input,
      });
      return this.mapper.toKnowledge(unwrapEnvelope(res.data));
    });
  }

  remove(id: string): Promise<void> {
    return this.execute(async () => {
      await KnowledgesService.deleteKnowledge({ path: { id } });
    });
  }

  index(id: string): Promise<void> {
    return this.execute(async () => {
      await KnowledgesService.indexKnowledge({ path: { id } });
    });
  }

  query(
    id: string,
    q: string,
    mode: KnowledgeQueryMode,
    topK: number,
  ): Promise<IQueryResult> {
    return this.execute(async () => {
      const res = await KnowledgesService.queryKnowledge({
        path: { id },
        body: { query: q, mode, topK },
      });
      return this.mapper.toQueryResult(unwrapEnvelope(res.data));
    });
  }

  listSources(id: string, filter: ISourceFilter): Promise<ISourcePage> {
    return this.execute(async () => {
      const res = await KnowledgeSourcesService.getKnowledgeSources({
        path: { knowledgeId: id },
        query: {
          page: filter.page,
          perPage: filter.perPage,
          search: filter.search || undefined,
          status: filter.status,
          type: filter.type,
        },
      });
      return this.mapper.toSourcePage(unwrapEnvelope(res.data), filter);
    });
  }

  listImports(id: string): Promise<IImportJob[]> {
    return this.execute(async () => {
      const res = await KnowledgeSourcesService.getKnowledgeSourceImports({
        path: { knowledgeId: id },
      });
      return this.mapper.toImportJobs(unwrapEnvelope(res.data));
    });
  }

  // Raw bytes, so the generated SDK (which expects the JSON envelope) is
  // bypassed: axios blob response on the shared instance keeps the Bearer
  // header, and the filename comes back in Content-Disposition.
  fetchSourceContent(
    id: string,
    sourceId: string,
    disposition: SourceContentDisposition,
  ): Promise<ISourceContent> {
    return this.execute(async () => {
      const res = await apiClient.instance.get<unknown>(
        `/knowledges/${id}/sources/${sourceId}/content`,
        { params: { disposition }, responseType: 'blob' },
      );
      const blob = res.data instanceof Blob ? res.data : new Blob([]);
      return {
        blob,
        filename: filenameFromDisposition(
          res.headers['content-disposition'],
          sourceId,
        ),
        contentType:
          typeof res.headers['content-type'] === 'string'
            ? res.headers['content-type']
            : blob.type,
      };
    });
  }

  exportSources(
    id: string,
    selection: ISourceExportSelection,
  ): Promise<ISourceContent> {
    return this.execute(async () => {
      // Ids win when present, matching the API: a tick-list and a filter can
      // disagree by the time the request lands, and the ticks are what the
      // user actually saw.
      const params: Record<string, string> = {};
      if (selection.ids && selection.ids.length > 0) {
        params.ids = selection.ids.join(',');
      } else {
        if (selection.search) params.search = selection.search;
        if (selection.status) params.status = selection.status;
        if (selection.type) params.type = selection.type;
      }
      const res = await apiClient.instance.get<unknown>(
        `/knowledges/${id}/sources/export`,
        { params, responseType: 'blob' },
      );
      const blob = res.data instanceof Blob ? res.data : new Blob([]);
      return {
        blob,
        filename: filenameFromDisposition(
          res.headers['content-disposition'],
          `${id}-sources.zip`,
        ),
        contentType:
          typeof res.headers['content-type'] === 'string'
            ? res.headers['content-type']
            : blob.type,
      };
    });
  }

  addTextSource(
    id: string,
    name: string,
    content: string,
  ): Promise<ISource | null> {
    return this.execute(async () => {
      const res = await KnowledgeSourcesService.addKnowledgeSource({
        path: { knowledgeId: id },
        body: { type: 'text', name, content },
      });
      return this.mapper.toSource(unwrapEnvelope(res.data));
    });
  }

  addUrlSource(id: string, name: string, url: string): Promise<ISource | null> {
    return this.execute(async () => {
      const res = await KnowledgeSourcesService.addKnowledgeSource({
        path: { knowledgeId: id },
        body: { type: 'url', name, url },
      });
      return this.mapper.toSource(unwrapEnvelope(res.data));
    });
  }

  // Multipart can't go through the generated SDK; post on the axios instance
  // directly (reuses the apiUrl base + Bearer interceptor).
  addFileSource(id: string, file: File): Promise<ISource | null> {
    return this.execute(async () => {
      const form = new FormData();
      form.append('type', 'file');
      form.append('name', file.name);
      form.append('file', file);
      const res = await apiClient.instance.post(
        `/knowledges/${id}/sources`,
        form,
      );
      return this.mapper.toSource(unwrapEnvelope(res.data));
    });
  }

  addFileSources(id: string, files: File[]): Promise<ISourceFilesResult> {
    return this.execute(async () => {
      const form = new FormData();
      for (const file of files) form.append('files', file);
      const res = await apiClient.instance.post(
        `/knowledges/${id}/sources/files`,
        form,
      );
      return this.mapper.toFilesResult(unwrapEnvelope(res.data));
    });
  }

  addSourcesFromArchive(id: string, file: File): Promise<ISourceArchiveResult> {
    return this.execute(async () => {
      const form = new FormData();
      form.append('file', file);
      const res = await apiClient.instance.post(
        `/knowledges/${id}/sources/from-archive`,
        form,
      );
      return this.mapper.toArchiveResult(unwrapEnvelope(res.data));
    });
  }

  addSourcesFromSitemap(
    id: string,
    sitemapUrl: string,
    urlPrefix?: string,
  ): Promise<ISourceSitemapResult> {
    return this.execute(async () => {
      const body: { sitemapUrl: string; urlPrefix?: string } = { sitemapUrl };
      if (urlPrefix) body.urlPrefix = urlPrefix;
      const res = await apiClient.instance.post(
        `/knowledges/${id}/sources/from-sitemap`,
        body,
      );
      return this.mapper.toSitemapResult(unwrapEnvelope(res.data));
    });
  }

  removeSource(id: string, sourceId: string): Promise<void> {
    return this.execute(async () => {
      await KnowledgeSourcesService.deleteKnowledgeSource({
        path: { knowledgeId: id, sourceId },
      });
    });
  }

  reindexSource(id: string, sourceId: string): Promise<void> {
    return this.execute(async () => {
      await apiClient.instance.post(
        `/knowledges/${id}/sources/${sourceId}/reindex`,
      );
    });
  }

  graphLabels(
    id: string,
    search?: string,
    limit?: number,
  ): Promise<IGraphLabels> {
    return this.execute(async () => {
      const res = await KnowledgesService.getGraphLabels({
        path: { id },
        query: { search, limit },
      });
      return this.mapper.toLabelsResult(unwrapEnvelope(res.data));
    });
  }

  graph(
    id: string,
    label: string,
    maxDepth: number,
    maxNodes: number,
  ): Promise<IGraph> {
    return this.execute(async () => {
      const res = await KnowledgesService.getGraph({
        path: { id },
        query: { label, maxDepth, maxNodes },
      });
      return this.mapper.toGraph(unwrapEnvelope(res.data));
    });
  }
}
