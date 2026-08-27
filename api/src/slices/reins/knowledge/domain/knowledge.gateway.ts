import {
  IKnowledgeData,
  ICreateKnowledgeData,
  IUpdateKnowledgeData,
  IIndexStatePatch,
  IInstanceStatePatch,
  IRawKnowledgeSearchResult,
  MigrationStateTypes,
  QueryModeTypes,
  IGetGraphParams,
  IGraphData,
} from './knowledge.types';

export abstract class IKnowledgeGateway {
  abstract findAll(): Promise<IKnowledgeData[]>;
  abstract findById(id: string): Promise<IKnowledgeData | null>;
  abstract findExistingByIds(ids: string[]): Promise<IKnowledgeData[]>;
  abstract create(data: ICreateKnowledgeData): Promise<IKnowledgeData>;
  abstract update(
    id: string,
    data: IUpdateKnowledgeData,
  ): Promise<IKnowledgeData>;
  abstract updateIndexState(
    id: string,
    patch: IIndexStatePatch,
  ): Promise<IKnowledgeData>;
  abstract updateInstanceState(
    id: string,
    patch: IInstanceStatePatch,
  ): Promise<IKnowledgeData>;
  abstract updateMigrationState(
    id: string,
    state: MigrationStateTypes,
  ): Promise<IKnowledgeData>;
  abstract delete(id: string): Promise<void>;

  abstract searchKnowledge(
    knowledgeId: string,
    query: string,
    mode?: QueryModeTypes,
    topK?: number,
  ): Promise<IRawKnowledgeSearchResult>;

  abstract getGraphLabels(knowledgeId: string): Promise<string[]>;
  abstract getGraph(
    knowledgeId: string,
    params: IGetGraphParams,
  ): Promise<IGraphData>;
}
