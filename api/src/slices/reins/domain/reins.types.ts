export type IndexStatusTypes = 'idle' | 'indexing' | 'ready' | 'failed';

export type SourceTypes = 'file' | 'url' | 'text';

export type QueryModeTypes = 'hybrid' | 'local' | 'global' | 'naive';

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
  sources?: ISourceData[];
}

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

export interface IUploadedSourceFile {
  url: string;
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
