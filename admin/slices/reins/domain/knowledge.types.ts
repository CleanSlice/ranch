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

export type IndexStatus = 'idle' | 'indexing' | 'ready' | 'failed';
export type SourceType = 'file' | 'url' | 'text';
export type KnowledgeQueryMode = 'hybrid' | 'local' | 'global' | 'naive';

export type InstanceState =
  | 'absent'
  | 'starting'
  | 'ready'
  | 'failed'
  | 'stopping';
export type MigrationState = 'notStarted' | 'inProgress' | 'done' | 'failed';

export interface IKnowledge {
  id: string;
  name: string;
  description: string | null;
  indexStatus: IndexStatus;
  indexError: string | null;
  indexedAt: string | null;
  indexStartedAt: string | null;
  instanceState: InstanceState;
  instanceError: string | null;
  migrationState: MigrationState;
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
  createdAt: string;
  updatedAt: string;
}

export interface ICreateKnowledgeInput {
  name: string;
  description?: string;
}

export interface IUpdateKnowledgeInput {
  name?: string;
  description?: string | null;
}

export interface IKnowledgeSetupStatus {
  hasChatCredential: boolean;
  hasEmbeddingCredential: boolean;
  hasUrl: boolean;
  hasBucket: boolean;
  hasCredentialsSelected: boolean;
  isHealthy: boolean;
}

export interface IKnowledgeStatus {
  enabled: boolean;
  setup: IKnowledgeSetupStatus;
}

export interface ISourceArchiveResult {
  detected: number;
  started: boolean;
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
