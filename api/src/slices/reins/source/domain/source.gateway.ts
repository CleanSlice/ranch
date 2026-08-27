import {
  ISourceData,
  ICreateSourceData,
  ISourceIndexStatePatch,
  IUploadSourceFileInput,
  IUploadSourceStreamInput,
  IUploadedSourceFile,
} from './source.types';

export abstract class ISourceGateway {
  abstract findByKnowledgeId(knowledgeId: string): Promise<ISourceData[]>;
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
