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
  ISourceBreakdown,
  ISourceTextStatePatch,
  SourceTextStateTypes,
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
  /** Counts by type and total stored size, one query: what the Overview tab shows. */
  abstract breakdown(knowledgeId: string): Promise<ISourceBreakdown>;
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
  /** Owned by reins/extraction; nothing else writes text state. */
  abstract updateTextState(
    id: string,
    patch: ISourceTextStatePatch,
  ): Promise<void>;
  /** Rows in one text state across every knowledge - the boot-time requeue. */
  abstract findByTextState(
    state: SourceTextStateTypes,
  ): Promise<ISourceData[]>;
  abstract removeFromIndex(source: ISourceData): Promise<void>;
  /**
   * Forget what the retrieval service holds for this source and put the row
   * back to queued, so the next index run sends it again. For when what
   * should be indexed changed under an existing claim (OCR text landing on a
   * row that was indexed from the file).
   */
  abstract resetIndexClaim(source: ISourceData): Promise<void>;
  abstract removeAllByKnowledge(knowledgeId: string): Promise<void>;
}
