import { Readable } from 'stream';

export type SourceTypes = 'file' | 'url' | 'text';

/**
 * queued -> processing -> indexed | failed; failed -> queued on retry.
 * "indexed" means the retrieval service reports the document processed and
 * searchable — not merely handed over.
 */
export type SourceIndexStateTypes =
  | 'queued'
  | 'processing'
  | 'indexed'
  | 'failed';

export interface ISourceData {
  id: string;
  knowledgeId: string;
  type: SourceTypes;
  name: string;
  url: string | null;
  mimeType: string | null;
  content: string | null;
  sizeBytes: number | null;
  indexState: SourceIndexStateTypes;
  indexError: string | null;
  indexedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ISourceIndexStatePatch {
  indexState: SourceIndexStateTypes;
  indexError?: string | null;
  indexedAt?: Date | null;
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

export interface IFilesImportResult {
  added: number;
  skipped: number;
  failed: number;
  /** One `"<filename>: <reason>"` line per failed upload. */
  errors: string[];
}
