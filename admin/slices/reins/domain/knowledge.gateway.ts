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
} from './knowledge.types';

/** Contract for the knowledge-bases API. Implemented by `KnowledgeGateway`. */
export abstract class IKnowledgeGateway {
  abstract status(): Promise<IKnowledgeStatus>;
  abstract findAll(): Promise<IKnowledge[]>;
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
  abstract listSources(id: string): Promise<ISource[]>;
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
  abstract graphLabels(): Promise<string[]>;
  abstract graph(
    label: string,
    maxDepth: number,
    maxNodes: number,
  ): Promise<IGraph>;
}
