import {
  ISourceData,
  ICreateSourceData,
  ISourceContent,
  ISourceCounts,
  ISourceFilter,
  ISourceIndexStatePatch,
  ISourcePage,
  ISourceSelection,
  IUploadSourceFileInput,
  IUploadSourceStreamInput,
  IUploadedSourceFile,
  ISourceIndexOutcome,
} from './source.types';

export abstract class ISourceGateway {
  abstract findByKnowledgeId(knowledgeId: string): Promise<ISourceData[]>;
  abstract findPage(
    knowledgeId: string,
    filter: ISourceFilter,
  ): Promise<ISourcePage>;
  /**
   * Index progress per knowledge. Knowledges with no sources are absent from
   * the map; callers treat that as all zeros.
   */
  abstract countByKnowledgeIds(
    knowledgeIds: string[],
  ): Promise<Map<string, ISourceCounts>>;
  /** Every source matching an explicit id list or the list's own filter. */
  abstract findForExport(
    knowledgeId: string,
    selection: ISourceSelection,
  ): Promise<ISourceData[]>;
  abstract findById(id: string): Promise<ISourceData | null>;
  abstract create(data: ICreateSourceData): Promise<ISourceData>;
  abstract createMany(data: ICreateSourceData[]): Promise<ISourceData[]>;
  abstract delete(id: string): Promise<void>;

  abstract uploadFile(
    input: IUploadSourceFileInput,
  ): Promise<IUploadedSourceFile>;
  abstract uploadFileStream(
    input: IUploadSourceStreamInput,
  ): Promise<IUploadedSourceFile>;
  abstract deleteFile(url: string): Promise<void>;
  /** Bytes of a file or text source. Throws for url sources. */
  abstract readContent(source: ISourceData): Promise<ISourceContent>;

  abstract indexSources(sources: ISourceData[]): Promise<ISourceIndexOutcome[]>;
  /**
   * Sources handed to LightRAG that nothing has confirmed yet, across every
   * knowledge. These are what a reconcile pass has to look at.
   */
  abstract findUnconfirmed(): Promise<ISourceData[]>;
  /**
   * Ask LightRAG about each source's stored handle once and write down what it
   * says. Unlike `indexSources` this never uploads and never waits: a document
   * still in the pipeline is simply left for the next pass.
   */
  abstract confirmProcessed(
    sources: ISourceData[],
  ): Promise<ISourceIndexOutcome[]>;
  /** Hands the source to the retrieval service and marks it processing. */
  abstract indexSource(source: ISourceData): Promise<void>;
  /**
   * Polls the retrieval service until the source's document reaches a
   * terminal state, recording indexState/indexError/indexedAt as it goes.
   */
  abstract waitForSourceIndexed(sourceId: string): Promise<ISourceData>;
  abstract updateIndexState(
    id: string,
    patch: ISourceIndexStatePatch,
  ): Promise<void>;
  abstract removeFromIndex(source: ISourceData): Promise<void>;
  abstract removeAllByKnowledge(knowledgeId: string): Promise<void>;
}
