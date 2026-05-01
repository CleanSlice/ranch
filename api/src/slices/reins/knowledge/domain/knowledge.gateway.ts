import {
  IKnowledgeData,
  ICreateKnowledgeData,
  IUpdateKnowledgeData,
  IIndexStatePatch,
  IKnowledgeQueryResult,
  QueryModeTypes,
  IGetGraphParams,
  IGraphData,
} from './knowledge.types';

export abstract class IKnowledgeGateway {
  abstract findAll(): Promise<IKnowledgeData[]>;
  abstract findById(id: string): Promise<IKnowledgeData | null>;
  abstract create(data: ICreateKnowledgeData): Promise<IKnowledgeData>;
  abstract update(
    id: string,
    data: IUpdateKnowledgeData,
  ): Promise<IKnowledgeData>;
  abstract updateIndexState(
    id: string,
    patch: IIndexStatePatch,
  ): Promise<IKnowledgeData>;
  abstract delete(id: string): Promise<void>;

  abstract searchKnowledge(
    knowledgeId: string,
    query: string,
    mode?: QueryModeTypes,
    topK?: number,
  ): Promise<IKnowledgeQueryResult>;

  abstract getGraphLabels(): Promise<string[]>;
  abstract getGraph(params: IGetGraphParams): Promise<IGraphData>;
}
