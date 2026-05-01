export type { QueryModeTypes } from '../../lightrag/domain/lightrag.types';

export type IndexStatusTypes = 'idle' | 'indexing' | 'ready' | 'failed';

export interface IKnowledgeData {
  id: string;
  name: string;
  description: string | null;
  entityTypes: string[];
  relationshipTypes: string[];
  indexStatus: IndexStatusTypes;
  indexError: string | null;
  indexedAt: Date | null;
  indexStartedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICreateKnowledgeData {
  name: string;
  description?: string;
  entityTypes?: string[];
  relationshipTypes?: string[];
}

export interface IUpdateKnowledgeData {
  name?: string;
  description?: string | null;
  entityTypes?: string[];
  relationshipTypes?: string[];
}

export interface IIndexStatePatch {
  indexStatus: IndexStatusTypes;
  indexError?: string | null;
  indexedAt?: Date | null;
  indexStartedAt?: Date | null;
}

export interface IKnowledgeQueryReference {
  referenceId: string;
  filePath: string;
}

export interface IKnowledgeQueryResult {
  answer: string;
  references: IKnowledgeQueryReference[];
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
