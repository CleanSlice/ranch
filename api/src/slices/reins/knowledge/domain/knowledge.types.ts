import type { InstanceStateTypes } from '../../instance/domain/instance.types';

export type { QueryModeTypes } from '../../lightrag/domain/lightrag.types';
export type { InstanceStateTypes };

export type IndexStatusTypes = 'idle' | 'indexing' | 'ready' | 'failed';

export type MigrationStateTypes =
  | 'notStarted'
  | 'inProgress'
  | 'done'
  | 'failed';

export interface IKnowledgeData {
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
