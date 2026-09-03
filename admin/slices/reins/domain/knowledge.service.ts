import type { IKnowledgeGateway } from './knowledge.gateway';
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
} from './knowledge.types';

/**
 * Domain service for knowledge bases. The store layers the reactive list +
 * status/setup flags and composes startIndex (index → re-fetch).
 */
export class KnowledgeService {
  constructor(private gateway: IKnowledgeGateway) {}

  status(): Promise<IKnowledgeStatus> {
    return this.gateway.status();
  }

  findAll(): Promise<IKnowledge[]> {
    return this.gateway.findAll();
  }

  findPage(
    search: string | undefined,
    page: number,
    perPage: number,
  ): Promise<IKnowledgePage> {
    return this.gateway.findPage(search, page, perPage);
  }

  findById(id: string): Promise<IKnowledge | null> {
    return this.gateway.findById(id);
  }

  create(input: ICreateKnowledgeInput): Promise<IKnowledge | null> {
    return this.gateway.create(input);
  }

  update(
    id: string,
    input: IUpdateKnowledgeInput,
  ): Promise<IKnowledge | null> {
    return this.gateway.update(id, input);
  }

  remove(id: string): Promise<void> {
    return this.gateway.remove(id);
  }

  index(id: string): Promise<void> {
    return this.gateway.index(id);
  }

  query(
    id: string,
    q: string,
    mode: KnowledgeQueryMode,
    topK: number,
  ): Promise<IQueryResult> {
    return this.gateway.query(id, q, mode, topK);
  }

  listSources(id: string, filter: ISourceFilter): Promise<ISourcePage> {
    return this.gateway.listSources(id, filter);
  }

  listImports(id: string): Promise<IImportJob[]> {
    return this.gateway.listImports(id);
  }

  fetchSourceContent(
    id: string,
    sourceId: string,
    disposition: SourceContentDisposition,
  ): Promise<ISourceContent> {
    return this.gateway.fetchSourceContent(id, sourceId, disposition);
  }

  exportSources(
    id: string,
    selection: ISourceExportSelection,
  ): Promise<ISourceContent> {
    return this.gateway.exportSources(id, selection);
  }

  addTextSource(
    id: string,
    name: string,
    content: string,
  ): Promise<ISource | null> {
    return this.gateway.addTextSource(id, name, content);
  }

  addUrlSource(id: string, name: string, url: string): Promise<ISource | null> {
    return this.gateway.addUrlSource(id, name, url);
  }

  addFileSource(id: string, file: File): Promise<ISource | null> {
    return this.gateway.addFileSource(id, file);
  }

  addFileSources(id: string, files: File[]): Promise<ISourceFilesResult> {
    return this.gateway.addFileSources(id, files);
  }

  addSourcesFromArchive(id: string, file: File): Promise<ISourceArchiveResult> {
    return this.gateway.addSourcesFromArchive(id, file);
  }

  addSourcesFromSitemap(
    id: string,
    sitemapUrl: string,
    urlPrefix?: string,
  ): Promise<ISourceSitemapResult> {
    return this.gateway.addSourcesFromSitemap(id, sitemapUrl, urlPrefix);
  }

  removeSource(id: string, sourceId: string): Promise<void> {
    return this.gateway.removeSource(id, sourceId);
  }

  reindexSource(id: string, sourceId: string): Promise<void> {
    return this.gateway.reindexSource(id, sourceId);
  }

  graphLabels(
    id: string,
    search?: string,
    limit?: number,
  ): Promise<IGraphLabels> {
    return this.gateway.graphLabels(id, search, limit);
  }

  graph(
    id: string,
    label: string,
    maxDepth: number,
    maxNodes: number,
  ): Promise<IGraph> {
    return this.gateway.graph(id, label, maxDepth, maxNodes);
  }
}
