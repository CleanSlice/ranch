import {
  IKnowledgeData,
  ICreateKnowledgeData,
  IUpdateKnowledgeData,
  IReinsSourceData,
  ICreateSourceData,
  IndexStatusTypes,
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
    patch: {
      indexStatus: IndexStatusTypes;
      indexError?: string | null;
      indexedAt?: Date | null;
      indexStartedAt?: Date | null;
    },
  ): Promise<IKnowledgeData>;
  abstract deleteKnowledge(id: string): Promise<void>;

  abstract findSourcesByKnowledge(
    knowledgeId: string,
  ): Promise<IReinsSourceData[]>;
  abstract findSourceById(id: string): Promise<IReinsSourceData | null>;
  abstract createSource(data: ICreateSourceData): Promise<IReinsSourceData>;
  abstract setSourceLightragDocId(
    id: string,
    lightragDocId: string,
  ): Promise<IReinsSourceData>;
  abstract deleteSource(id: string): Promise<void>;
}
