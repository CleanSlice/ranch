// Domain types for knowledge bases (reins).
//
// Pragmatic exception: `IQueryResult` / `IGraph` are the opaque, deeply-nested
// read structures the UI renders verbatim, so they alias the generated
// `#api` DTOs (as the original store did) rather than being re-derived here.
// The slice's own entities/inputs below are pure domain.
import type { GraphDto, KnowledgeQueryResultDto } from '#api/data';

export type IQueryResult = KnowledgeQueryResultDto;
export type IGraph = GraphDto;

export interface IGraphLabels {
  labels: string[];
  total: number;
  truncated: boolean;
}

export type IndexStatus =
  | 'idle'
  | 'indexing'
  | 'ready'
  | 'failed'
  | 'empty'
  | 'partial';
export type SourceType = 'file' | 'url' | 'text';
/**
 * `retrying` is a failure the API will try again on its own (a model outage,
 * a lost connection); `failed` is one nobody will touch without a person.
 */
export type SourceIndexStatus = 'indexed' | 'pending' | 'retrying' | 'failed';
/**
 * Text extraction for a PDF without a text layer: `none` (not a PDF, or it
 * has its own text), `pending` (probing or OCR running), `ready` (recognised
 * text is what gets indexed), `failed` (see textError).
 */
export type SourceTextState = 'none' | 'pending' | 'ready' | 'failed';
export type ImportJobKind = 'archive' | 'extraction';
export type KnowledgeQueryMode = 'hybrid' | 'local' | 'global' | 'naive';

export type InstanceState =
  | 'absent'
  | 'starting'
  | 'ready'
  | 'failed'
  | 'stopping';
export type MigrationState = 'notStarted' | 'inProgress' | 'done' | 'failed';
/** Whether readers of agent answers may open the documents of a base that were cited to them (CLEAN-138). Per base, never per source. */
export type ReaderAccess = 'closed' | 'open';

export interface IKnowledge {
  id: string;
  name: string;
  description: string | null;
  indexStatus: IndexStatus;
  indexError: string | null;
  indexedAt: string | null;
  indexStartedAt: string | null;
  /** Index progress over the attached sources, as counted by the API. */
  sourceCount: number;
  indexedCount: number;
  /** Terminal failures only. */
  failedCount: number;
  /** Failed for a reason that passes; the API retries them on its own. */
  retryingCount: number;
  /** Handed to LightRAG, not finished yet. Not an error, just not done. */
  processingCount: number;
  /**
   * The run behind an `indexing` status still exists in the API. When this is
   * false the status is a leftover and the API will accept a new run at once.
   */
  indexRunAlive: boolean;
  instanceState: InstanceState;
  instanceError: string | null;
  migrationState: MigrationState;
  readerAccess: ReaderAccess;
  /** Present on list entries — context for choosing a base. */
  sourcesCount?: number;
  totalSizeBytes?: number;
  createdAt: string;
  updatedAt: string;
  sources?: ISource[];
}

export interface IKnowledgePage {
  items: IKnowledge[];
  total: number;
  page: number;
  perPage: number;
}

export type SourceIndexState = 'queued' | 'processing' | 'indexed' | 'failed';

export interface ISource {
  id: string;
  knowledgeId: string;
  type: SourceType;
  name: string;
  url: string | null;
  mimeType: string | null;
  content: string | null;
  sizeBytes: number | null;
  indexed: boolean;
  indexStatus: SourceIndexStatus;
  /** "indexed" means searchable — not merely handed over. */
  indexState: SourceIndexState;
  indexError: string | null;
  indexedAt: string | null;
  /** Failed attempts since the last success or manual retry. */
  indexAttempts: number;
  /** When the API will retry a failed row by itself; null when it will not. */
  indexRetryAt: string | null;
  textState: SourceTextState;
  textError: string | null;
  /** How many assistant answers cited this source (CLEAN-138). */
  cited: number;
  /** Current likes on those citations; a withdrawn rating is not counted. */
  likes: number;
  /** Current dislikes on those citations. */
  dislikes: number;
  createdAt: string;
  updatedAt: string;
}

/** Columns the sources list can be ordered by (CLEAN-138). */
export type SourceSort = 'createdAt' | 'cited' | 'likes' | 'dislikes';
export type SortOrder = 'asc' | 'desc';

export interface ISourceFilter {
  page: number;
  perPage: number;
  search?: string;
  status?: SourceIndexStatus;
  type?: SourceType;
  /** Absent means the API default: oldest first, so page 1 stays stable while an import adds rows. */
  sort?: SourceSort;
  order?: SortOrder;
}

export interface ISourcePage {
  items: ISource[];
  total: number;
  page: number;
  perPage: number;
}

export type ImportJobStatus = 'running' | 'done' | 'failed';

/** Progress of one background bulk import (archive). */
export interface IImportJob {
  id: string;
  knowledgeId: string;
  kind: ImportJobKind;
  status: ImportJobStatus;
  detected: number;
  added: number;
  skipped: number;
  failed: number;
  errors: string[];
  startedAt: string;
  finishedAt: string | null;
}

/**
 * What the Export button sends. Either the ticked ids, or the same filter the
 * table is showing - "select all" must not mean "the 50 rows on this page",
 * and 356 ids in a query string is not a URL.
 */
export interface ISourceExportSelection {
  ids?: string[];
  search?: string;
  status?: SourceIndexStatus;
  type?: SourceType;
}

export type SourceContentDisposition = 'inline' | 'attachment';

/** Bytes of a source as fetched for preview or download. */
export interface ISourceContent {
  blob: Blob;
  filename: string;
  contentType: string;
}

export interface ICreateKnowledgeInput {
  name: string;
  description?: string;
}

export interface IUpdateKnowledgeInput {
  name?: string;
  description?: string | null;
  readerAccess?: ReaderAccess;
}

export interface IKnowledgeSetupStatus {
  hasChatCredential: boolean;
  hasEmbeddingCredential: boolean;
  hasUrl: boolean;
  hasBucket: boolean;
  hasCredentialsSelected: boolean;
  isHealthy: boolean;
}

/**
 * What LightRAG is actually running, read from its own /health. Its bindings
 * are resolved from container env at startup, so this is the effective config
 * regardless of what is selected in the admin.
 */
export interface IKnowledgeRuntimeConfig {
  llmBinding: string | null;
  llmModel: string | null;
  embeddingBinding: string | null;
  embeddingModel: string | null;
  embeddingBindingHost: string | null;
}

export interface IKnowledgeStatus {
  enabled: boolean;
  setup: IKnowledgeSetupStatus;
  runtime: IKnowledgeRuntimeConfig | null;
}

export interface ISourceArchiveResult {
  detected: number;
  started: boolean;
  /** Id of the background job to follow via listImports. */
  jobId: string;
}

export interface ISourceSitemapResult {
  added: number;
  discovered: number;
}

export interface ISourceFilesResult {
  added: number;
  skipped: number;
  failed: number;
  errors: string[];
}

/** What the Overview tab shows about a base's sources, from one request. */
export interface IKnowledgeOverview {
  sourceCount: number;
  indexedCount: number;
  failedCount: number;
  retryingCount: number;
  processingCount: number;
  byType: Record<SourceType, number>;
  totalSizeBytes: number;
}
