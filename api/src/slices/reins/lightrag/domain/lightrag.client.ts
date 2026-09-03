import {
  IIngestTextInput,
  IIngestUrlInput,
  IIngestFileInput,
  IIngestResult,
  IQueryInput,
  IQueryResult,
  ILightragHealth,
  IGetGraphInput,
  ILightragGraph,
  ITrackStatus,
  IDocumentRecord,
  IPipelineStatus,
} from './lightrag.types';

export abstract class ILightragClient {
  abstract health(): Promise<ILightragHealth>;
  abstract ingestText(input: IIngestTextInput): Promise<IIngestResult>;
  abstract ingestUrl(input: IIngestUrlInput): Promise<IIngestResult>;
  abstract ingestFile(input: IIngestFileInput): Promise<IIngestResult>;
  abstract query(input: IQueryInput): Promise<IQueryResult>;
  abstract deleteDocumentsByTrackIds(
    knowledgeId: string,
    trackIds: string[],
  ): Promise<void>;
  abstract getTrackStatus(
    knowledgeId: string,
    trackId: string,
  ): Promise<ITrackStatus>;
  abstract listDocuments(knowledgeId: string): Promise<IDocumentRecord[]>;
  abstract getGraphLabels(knowledgeId?: string): Promise<string[]>;
  abstract getGraph(input: IGetGraphInput): Promise<ILightragGraph>;
  abstract getPipelineStatus(knowledgeId?: string): Promise<IPipelineStatus>;
  /**
   * Put the whole backlog back on the pipeline: every document LightRAG holds
   * in PENDING, PROCESSING or FAILED, not only the failed ones its endpoint is
   * named after. Ingests nothing, so the only work it can start is work that
   * was already paid for once and never finished.
   */
  abstract restartPipeline(knowledgeId?: string): Promise<void>;
}
