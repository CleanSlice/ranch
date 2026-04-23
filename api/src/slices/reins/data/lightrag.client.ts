import {
  IIngestTextInput,
  IIngestUrlInput,
  IIngestFileInput,
  IIngestResult,
  IQueryInput,
  IQueryResultItem,
  ILightragHealth,
} from './lightrag.types';

export abstract class ILightragClient {
  abstract health(): Promise<ILightragHealth>;
  abstract ingestText(input: IIngestTextInput): Promise<IIngestResult>;
  abstract ingestUrl(input: IIngestUrlInput): Promise<IIngestResult>;
  abstract ingestFile(input: IIngestFileInput): Promise<IIngestResult>;
  abstract query(input: IQueryInput): Promise<IQueryResultItem[]>;
  abstract deleteDocument(workspace: string, docId: string): Promise<void>;
  abstract deleteWorkspace(workspace: string): Promise<void>;
}
