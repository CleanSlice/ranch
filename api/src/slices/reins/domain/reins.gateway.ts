import {
  IKnowledgeData,
  ICreateKnowledgeData,
  IUpdateKnowledgeData,
  IReinsSourceData,
  ICreateSourceData,
  IIndexStatePatch,
  IKnowledgeQueryResult,
  IUploadSourceFileInput,
  IUploadedSourceFile,
  QueryModeTypes,
  IGetGraphParams,
  IGraphData,
} from './reins.types';

export abstract class IReinsGateway {
  abstract findAllKnowledge(): Promise<IKnowledgeData[]>;
  abstract findKnowledgeById(id: string): Promise<IKnowledgeData | null>;
  abstract createKnowledge(data: ICreateKnowledgeData): Promise<IKnowledgeData>;
  abstract updateKnowledge(
    id: string,
    data: IUpdateKnowledgeData,
  ): Promise<IKnowledgeData>;
  abstract updateKnowledgeIndexState(
    id: string,
    patch: IIndexStatePatch,
  ): Promise<IKnowledgeData>;
  abstract deleteKnowledge(id: string): Promise<void>;

  abstract findSourcesByKnowledge(
    knowledgeId: string,
  ): Promise<IReinsSourceData[]>;
  abstract findSourceById(id: string): Promise<IReinsSourceData | null>;
  abstract createSource(data: ICreateSourceData): Promise<IReinsSourceData>;
  abstract deleteSource(id: string): Promise<void>;

  abstract uploadSourceFile(
    input: IUploadSourceFileInput,
  ): Promise<IUploadedSourceFile>;
  abstract deleteSourceFile(url: string): Promise<void>;

  abstract indexSource(source: IReinsSourceData): Promise<void>;
  abstract removeSourceFromIndex(source: IReinsSourceData): Promise<void>;
  abstract removeKnowledgeFromIndex(knowledgeId: string): Promise<void>;

  abstract searchKnowledge(
    knowledgeId: string,
    query: string,
    mode?: QueryModeTypes,
    topK?: number,
  ): Promise<IKnowledgeQueryResult>;

  abstract getGraphLabels(): Promise<string[]>;
  abstract getGraph(params: IGetGraphParams): Promise<IGraphData>;
}
