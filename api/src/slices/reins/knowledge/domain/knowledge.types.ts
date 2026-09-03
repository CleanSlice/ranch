import type { InstanceStateTypes } from '../../instance/domain/instance.types';

export type { QueryModeTypes } from '../../lightrag/domain/lightrag.types';
export type { InstanceStateTypes };

// 'empty' | 'indexing' | 'partial' | 'ready' are the derived rollup values;
// 'idle' and 'failed' survive only as stored legacy values until every base
// has been read through the derivation at least once.
export type IndexStatusTypes =
  | 'idle'
  | 'indexing'
  | 'ready'
  | 'failed'
  | 'empty'
  | 'partial';

export type MigrationStateTypes =
  | 'notStarted'
  | 'inProgress'
  | 'done'
  | 'failed';

/** One Knowledge row as stored; what the gateway reads and writes. */
export interface IKnowledgeRecord {
  id: string;
  name: string;
  description: string | null;
  /** The recorded name of this base's retrieval area. */
  workspace: string;
  indexStatus: IndexStatusTypes;
  indexError: string | null;
  indexedAt: Date | null;
  indexStartedAt: Date | null;
  instanceState: InstanceStateTypes;
  instanceError: string | null;
  instanceEndpoint: string | null;
  migrationState: MigrationStateTypes;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The row plus index progress over its sources, which lives in the source
 * slice and is stitched on by the service. `indexedCount / sourceCount` is
 * what the UI shows while a run is in flight.
 */
export interface IKnowledgeData extends IKnowledgeRecord {
  sourceCount: number;
  indexedCount: number;
  failedCount: number;
  /**
   * Sources LightRAG is still chunking. `ready` with a non-zero value here
   * means "searchable, but not all of it yet" - without it a base that stopped
   * waiting on a long document is indistinguishable from a finished one.
   */
  processingCount: number;
}

export interface ICreateKnowledgeData {
  name: string;
  description?: string;
}

export interface IUpdateKnowledgeData {
  name?: string;
  description?: string | null;
}

/** List entry with enough context to choose a base (FR-011). */
export interface IKnowledgeListItem extends IKnowledgeData {
  sourcesCount: number;
  totalSizeBytes: number;
}

export interface IFilterKnowledgeParams {
  search?: string;
  page?: number;
  perPage?: number;
}

export interface IKnowledgePage {
  items: IKnowledgeListItem[];
  total: number;
  page: number;
  perPage: number;
}

export interface IIndexStatePatch {
  indexStatus: IndexStatusTypes;
  indexError?: string | null;
  indexedAt?: Date | null;
  indexStartedAt?: Date | null;
}

export interface IInstanceStatePatch {
  instanceState: InstanceStateTypes;
  instanceError?: string | null;
  instanceEndpoint?: string | null;
}

export interface IKnowledgeQueryReference {
  referenceId: string;
  /** As upstream returns it. */
  filePath: string;
  /** Resolves to a Source row; null means an unresolvable reference — a
   * defect to see, not to hide. */
  sourceId: string | null;
  sourceName: string | null;
}

export interface IKnowledgeQueryResult {
  /** null when the base holds nothing relevant — never a generated answer
   * assembled from no context (FR-003). */
  answer: string | null;
  reason?: 'no_relevant_content';
  knowledgeId: string;
  /** false while the base's content is still being re-processed into its
   * own area (FR-036). */
  complete: boolean;
  references: IKnowledgeQueryReference[];
}

/** What the retrieval client returns before attribution is resolved. */
export interface IRawKnowledgeSearchResult {
  answer: string;
  references: { referenceId: string; filePath: string }[];
}

export interface IGetGraphLabelsParams {
  search?: string;
  limit?: number;
}

export interface IGraphLabelsResult {
  labels: string[];
  total: number;
  truncated: boolean;
}

export interface IGraphNodeData {
  id: string;
  label: string;
  entityType: string;
  description: string;
}

export interface IGraphEdgeData {
  id: string;
  source: string;
  target: string;
  weight: number;
  keywords: string;
  description: string;
}

export interface IGraphData {
  nodes: IGraphNodeData[];
  edges: IGraphEdgeData[];
  isTruncated: boolean;
}

export interface IGetGraphParams {
  label: string;
  maxDepth?: number;
  maxNodes?: number;
}
