import {
  ISourceData,
  ICreateSourceData,
  IUploadSourceFileInput,
  IUploadedSourceFile,
} from './source.types';

export abstract class ISourceGateway {
  abstract findByKnowledgeId(knowledgeId: string): Promise<ISourceData[]>;
  abstract findById(id: string): Promise<ISourceData | null>;
  abstract create(data: ICreateSourceData): Promise<ISourceData>;
  abstract delete(id: string): Promise<void>;

  abstract uploadFile(
    input: IUploadSourceFileInput,
  ): Promise<IUploadedSourceFile>;
  abstract deleteFile(url: string): Promise<void>;

  abstract indexSource(source: ISourceData): Promise<void>;
  abstract removeFromIndex(source: ISourceData): Promise<void>;
  abstract removeAllByKnowledge(knowledgeId: string): Promise<void>;
}
