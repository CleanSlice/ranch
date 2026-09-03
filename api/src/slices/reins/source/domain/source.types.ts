import { Readable } from 'stream';

export type SourceTypes = 'file' | 'url' | 'text';

/**
 * Per-source view of the last index run. `indexed` = LightRAG confirmed the
 * document as processed; `failed` = the last run reported an error for it and
 * nothing has succeeded since; `pending` = never sent, or sent and still
 * waiting for a verdict.
 */
export type SourceIndexStatusTypes = 'indexed' | 'pending' | 'failed';

/**
 * Stored per-source ingestion state, the migration's resume marker:
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
  /** Kept for callers that only care about searchable-or-not. */
  indexed: boolean;
  indexStatus: SourceIndexStatusTypes;
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

export interface ISourceFilter {
  page: number;
  perPage: number;
  search?: string;
  status?: SourceIndexStatusTypes;
  type?: SourceTypes;
}

/**
 * What to export. `ids` is an explicit tick-list; without it the same filter
 * the list uses selects the rows, so "select all" can travel as three query
 * params instead of every id the user can see.
 */
export interface ISourceSelection {
  ids?: string[];
  search?: string;
  status?: SourceIndexStatusTypes;
  type?: SourceTypes;
}

export interface ISourcePage {
  items: ISourceData[];
  total: number;
  page: number;
  perPage: number;
}

export interface ISourceCounts {
  total: number;
  indexed: number;
  failed: number;
  /**
   * Handed to LightRAG and still moving through its pipeline: the run that
   * submitted them stopped waiting, but nothing is wrong with them. Counted
   * apart from the rest of `pending` so a base cannot report itself finished
   * while a document is still being chunked.
   */
  processing: number;
}

/**
 * Bytes of a source ready to stream to an HTTP response. `body` is consumed
 * exactly once by the caller.
 */
export interface ISourceContent {
  filename: string;
  contentType: string;
  contentLength: number | null;
  body: Readable;
}

/**
 * Result of pushing one source through LightRAG's ingest-then-process
 * pipeline.
 *
 * Three states, not two. `failed` means LightRAG rejected the document or the
 * pipeline gave up on it, and a human should look. `pending` means the run
 * stopped waiting before LightRAG finished - the document is still being
 * processed and the next run will pick it up. Collapsing the two is what
 * painted a healthy re-index of a large base red: on a base of 200 documents
 * the wait budget expires long before the pipeline does.
 */
export type SourceIndexOutcomeStatus = 'indexed' | 'pending' | 'failed';

export interface ISourceIndexOutcome {
  sourceId: string;
  name: string;
  status: SourceIndexOutcomeStatus;
  /** Kept for callers that only care about searchable-or-not. */
  indexed: boolean;
  /** Set for `failed`, and for `pending` as the reason the wait ended. */
  error: string | null;
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

export type ImportJobStatusTypes = 'running' | 'done' | 'failed';

/**
 * Progress of one background bulk import (archive today). Lives in memory
 * only: an import cannot outlive the process anyway, so there is nothing to
 * persist that would still be true after a restart.
 */
export interface IImportJob {
  id: string;
  knowledgeId: string;
  kind: 'archive';
  status: ImportJobStatusTypes;
  detected: number;
  added: number;
  skipped: number;
  failed: number;
  /** First N `"<name>: <reason>"` lines, capped by the registry. */
  errors: string[];
  startedAt: Date;
  finishedAt: Date | null;
}

export interface IArchiveImportResult {
  detected: number;
  started: boolean;
  jobId: string;
}

export interface IFilesImportResult {
  added: number;
  skipped: number;
  failed: number;
  /** One `"<filename>: <reason>"` line per failed upload. */
  errors: string[];
}
