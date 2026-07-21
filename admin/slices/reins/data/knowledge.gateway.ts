import { KnowledgesService, KnowledgeSourcesService } from '#api/data';
import { client as apiClient } from '#api/data/repositories/api/client.gen';
import { BaseGateway } from '#common/data/BaseGateway';
import { unwrapEnvelope } from '#common/data/unwrapEnvelope';
import { IKnowledgeGateway } from '../domain/knowledge.gateway';
import type {
  ICreateKnowledgeInput,
  IGraph,
  IKnowledge,
  IKnowledgeStatus,
  IQueryResult,
  ISource,
  ISourceArchiveResult,
  ISourceSitemapResult,
  IUpdateKnowledgeInput,
  KnowledgeQueryMode,
} from '../domain/knowledge.types';
import { KnowledgeMapper } from './knowledge.mapper';

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

  findAll(): Promise<IKnowledge[]> {
    return this.execute(async () => {
      const res = await KnowledgesService.getKnowledges();
      return this.mapper.toKnowledgeList(unwrapEnvelope(res.data));
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

  listSources(id: string): Promise<ISource[]> {
    return this.execute(async () => {
      const res = await KnowledgeSourcesService.getKnowledgeSources({
        path: { knowledgeId: id },
      });
      return this.mapper.toSourceList(unwrapEnvelope(res.data));
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

  graphLabels(): Promise<string[]> {
    return this.execute(async () => {
      const res = await KnowledgesService.getGraphLabels();
      return this.mapper.toLabels(unwrapEnvelope(res.data));
    });
  }

  graph(label: string, maxDepth: number, maxNodes: number): Promise<IGraph> {
    return this.execute(async () => {
      const res = await KnowledgesService.getGraph({
        query: { label, maxDepth, maxNodes },
      });
      return this.mapper.toGraph(unwrapEnvelope(res.data));
    });
  }
}
