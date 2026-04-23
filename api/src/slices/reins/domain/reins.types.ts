export type IndexStatusTypes = 'idle' | 'indexing' | 'ready' | 'failed';

export type SourceTypes = 'file' | 'url' | 'text';

export type QueryModeTypes = 'hybrid' | 'local' | 'global' | 'naive';

export interface IKnowledgeData {
  id: string;
  name: string;
  description: string | null;
  workspace: string;
  entityTypes: string[];
  relationshipTypes: string[];
  indexStatus: IndexStatusTypes;
  indexError: string | null;
  indexedAt: Date | null;
  indexStartedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  sources?: IReinsSourceData[];
}

export interface IReinsSourceData {
  id: string;
  knowledgeId: string;
  type: SourceTypes;
  name: string;
  url: string | null;
  mimeType: string | null;
  content: string | null;
  sizeBytes: number | null;
  lightragDocId: string | null;
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

export interface IKnowledgeQueryRecord {
  pageContent: string;
  metadata: {
    title?: string;
    source?: string;
    sourceId?: string;
  };
}
