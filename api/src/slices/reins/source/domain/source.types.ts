import { Readable } from 'stream';

export type SourceTypes = 'file' | 'url' | 'text';

export interface ISourceData {
  id: string;
  knowledgeId: string;
  type: SourceTypes;
  name: string;
  url: string | null;
  mimeType: string | null;
  content: string | null;
  sizeBytes: number | null;
  indexed: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICreateSourceData {
  knowledgeId: string;
  type: SourceTypes;
  name: string;
  url?: string;
  mimeType?: string;
  content?: string;
  sizeBytes?: number;
}

export interface IUploadSourceFileInput {
  knowledgeId: string;
  filename: string;
  body: Buffer;
  contentType: string;
}

export interface IUploadSourceStreamInput {
  knowledgeId: string;
  filename: string;
  body: Readable;
  contentType: string;
}

export interface IUploadedSourceFile {
  url: string;
}

export interface IArchiveImportResult {
  detected: number;
  started: boolean;
}
