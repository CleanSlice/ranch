import {
  IKnowledgeRecord,
  ICreateKnowledgeData,
  IUpdateKnowledgeData,
  IFilterKnowledgeParams,
  IKnowledgePage,
  IIndexStatePatch,
  IInstanceStatePatch,
  IRawKnowledgeSearchResult,
  MigrationStateTypes,
  QueryModeTypes,
  IGetGraphParams,
  IGraphData,
} from './knowledge.types';

export abstract class IKnowledgeGateway {
  abstract findAll(): Promise<IKnowledgeRecord[]>;
  abstract findPage(params: IFilterKnowledgeParams): Promise<IKnowledgePage>;
  abstract findById(id: string): Promise<IKnowledgeRecord | null>;
  abstract findExistingByIds(ids: string[]): Promise<IKnowledgeRecord[]>;
  abstract create(data: ICreateKnowledgeData): Promise<IKnowledgeRecord>;
  abstract update(
    id: string,
    data: IUpdateKnowledgeData,
  ): Promise<IKnowledgeRecord>;
  abstract updateIndexState(
    id: string,
    patch: IIndexStatePatch,
  ): Promise<IKnowledgeRecord>;
  abstract updateInstanceState(
    id: string,
    patch: IInstanceStatePatch,
  ): Promise<IKnowledgeRecord>;
  abstract updateMigrationState(
    id: string,
    state: MigrationStateTypes,
  ): Promise<IKnowledgeRecord>;
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
