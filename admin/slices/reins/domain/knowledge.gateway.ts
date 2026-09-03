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

/** Contract for the knowledge-bases API. Implemented by `KnowledgeGateway`. */
export abstract class IKnowledgeGateway {
  abstract status(): Promise<IKnowledgeStatus>;
  abstract findAll(): Promise<IKnowledge[]>;
  abstract findPage(
    search: string | undefined,
    page: number,
    perPage: number,
  ): Promise<IKnowledgePage>;
  abstract findById(id: string): Promise<IKnowledge | null>;
  abstract create(input: ICreateKnowledgeInput): Promise<IKnowledge | null>;
  abstract update(
    id: string,
    input: IUpdateKnowledgeInput,
  ): Promise<IKnowledge | null>;
  abstract remove(id: string): Promise<void>;
  abstract index(id: string): Promise<void>;
  abstract query(
    id: string,
    q: string,
    mode: KnowledgeQueryMode,
    topK: number,
  ): Promise<IQueryResult>;
  abstract listSources(id: string, filter: ISourceFilter): Promise<ISourcePage>;
  abstract listImports(id: string): Promise<IImportJob[]>;
  abstract fetchSourceContent(
    id: string,
    sourceId: string,
    disposition: SourceContentDisposition,
  ): Promise<ISourceContent>;
  abstract exportSources(
    id: string,
    selection: ISourceExportSelection,
  ): Promise<ISourceContent>;
  abstract addTextSource(
    id: string,
    name: string,
    content: string,
  ): Promise<ISource | null>;
  abstract addUrlSource(
    id: string,
    name: string,
    url: string,
  ): Promise<ISource | null>;
  abstract addFileSource(id: string, file: File): Promise<ISource | null>;
  abstract addFileSources(
    id: string,
    files: File[],
  ): Promise<ISourceFilesResult>;
  abstract addSourcesFromArchive(
    id: string,
    file: File,
  ): Promise<ISourceArchiveResult>;
  abstract addSourcesFromSitemap(
    id: string,
    sitemapUrl: string,
    urlPrefix?: string,
  ): Promise<ISourceSitemapResult>;
  abstract removeSource(id: string, sourceId: string): Promise<void>;
  abstract reindexSource(id: string, sourceId: string): Promise<void>;
  // Base-scoped: the graph and its labels describe one knowledge base only.
  abstract graphLabels(
    id: string,
    search?: string,
    limit?: number,
  ): Promise<IGraphLabels>;
  abstract graph(
    id: string,
    label: string,
    maxDepth: number,
    maxNodes: number,
  ): Promise<IGraph>;
}
