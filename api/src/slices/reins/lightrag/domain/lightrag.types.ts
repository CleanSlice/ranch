export type QueryModeTypes = 'hybrid' | 'local' | 'global' | 'naive';

// The instance IS the workspace: each call names the base it belongs to and
// the client resolves that base's endpoint. The old `workspace` body field
// was silently ignored by the server — that is the defect this replaces.
export interface IIngestTextInput {
  knowledgeId: string;
  text: string;
  fileSource?: string;
}

export interface IIngestUrlInput {
  knowledgeId: string;
  url: string;
}

export interface IIngestFileInput {
  knowledgeId: string;
  filename: string;
  mimeType: string;
  content: Buffer;
}

export interface IIngestResult {
  docId: string;
}

export interface IQueryInput {
  knowledgeId: string;
  query: string;
  mode?: QueryModeTypes;
  topK?: number;
}

export interface IQueryReference {
  referenceId: string;
  filePath: string;
}

export interface IQueryResult {
  answer: string;
  references: IQueryReference[];
}

export interface ILightragHealth {
  ok: boolean;
}

export interface IGetGraphInput {
  // Optional until the graph endpoints become base-scoped; undefined reads
  // the shared instance exactly as before.
  knowledgeId?: string;
  label: string;
  maxDepth?: number;
  maxNodes?: number;
}

export interface ILightragGraphNode {
  id: string;
  label: string;
  entityType: string;
  description: string;
}

export interface ILightragGraphEdge {
  id: string;
  source: string;
  target: string;
  weight: number;
  keywords: string;
  description: string;
}

export interface ILightragGraph {
  nodes: ILightragGraphNode[];
  edges: ILightragGraphEdge[];
  isTruncated: boolean;
}

export class LightragClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly path: string,
  ) {
    super(message);
    this.name = 'LightragClientError';
  }
}
